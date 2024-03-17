// deno-lint-ignore-file no-empty require-await
import * as Dotenv from "https://deno.land/std@0.217.0/dotenv/mod.ts";
import { Future } from "npm:@hazae41/future@1.0.3";
import { RpcErr, RpcError, RpcInvalidParamsError, RpcMethodNotFoundError, RpcOk, RpcRequest, RpcRequestInit } from "npm:@hazae41/jsonrpc@1.0.5";
import { Mutex } from "npm:@hazae41/mutex@1.2.12";
import { Memory, NetworkMixin, base16_decode_mixed, base16_encode_lower, initBundledOnce } from "npm:@hazae41/network-bundle@1.2.1";
import { None, Some } from "npm:@hazae41/option@1.0.27";
import * as Ethers from "npm:ethers";
import { warn } from "./libs/ethers/mod.ts";
import { Columns, MicroDB, Orders } from "./libs/microdb/microdb.ts";
import Abi from "./token.abi.json" with { type: "json" };

export async function main(prefix = "") {
  const envPath = new URL(import.meta.resolve("./.env.local")).pathname

  const {
    PRIVATE_KEY_ZERO_HEX = Deno.env.get(prefix + "PRIVATE_KEY_ZERO_HEX"),
  } = await Dotenv.load({ envPath, examplePath: null })

  if (PRIVATE_KEY_ZERO_HEX == null)
    throw new Error("PRIVATE_KEY_ZERO_HEX is not set")

  const privateKeyZeroHex = PRIVATE_KEY_ZERO_HEX

  return await serve({ privateKeyZeroHex })
}

export async function serve(params: {
  readonly privateKeyZeroHex: string,
}) {
  const { privateKeyZeroHex } = params

  await initBundledOnce()

  const chainIdString = "100"
  const contractZeroHex = "0x0a4d5EFEa910Ea5E39be428A3d57B80BFAbA52f4"

  const provider = new Ethers.JsonRpcProvider("https://gnosis-rpc.publicnode.com")
  const wallet = new Ethers.Wallet(privateKeyZeroHex).connect(provider)
  const contract = new Ethers.Contract(contractZeroHex, Abi, wallet)

  const chainIdNumber = Number(chainIdString)
  const chainIdBase16 = chainIdNumber.toString(16).padStart(64, "0")
  const chainIdMemory = base16_decode_mixed(chainIdBase16)

  const contractBase16 = contractZeroHex.slice(2).padStart(64, "0")
  const contractMemory = base16_decode_mixed(contractBase16)

  const receiverZeroHex = wallet.address
  const receiverBase16 = receiverZeroHex.slice(2).padStart(64, "0")
  const receiverMemory = base16_decode_mixed(receiverBase16)

  const nonceBytes = crypto.getRandomValues(new Uint8Array(32))
  const nonceMemory = new Memory(nonceBytes)
  const nonceBase16 = base16_encode_lower(nonceMemory)
  const nonceZeroHex = `0x${nonceBase16}`

  const mixinStruct = new NetworkMixin(chainIdMemory, contractMemory, receiverMemory, nonceMemory)

  const allSecretZeroHexSet = new Set<string>()

  let pendingSecretZeroHexArray = new Array<string>()
  let pendingTotalValueBigInt = 0n

  const mutex = new Mutex(undefined)

  let minimumBigInt = 2n ** 16n
  let minimumBase16 = minimumBigInt.toString(16).padStart(64, "0")
  let minimumZeroHex = `0x${minimumBase16}`

  const balanceByUuid = new Map<string, bigint>()

  const db = new MicroDB()

  const claim = async (pendingTotalValueBigInt2: bigint, pendingSecretZeroHexArray2: string[]) => {
    const backpressure = mutex.locked

    if (backpressure) {
      minimumBigInt = minimumBigInt * 2n
      minimumBase16 = minimumBigInt.toString(16).padStart(64, "0")
      minimumZeroHex = `0x${minimumBase16}`

      console.log(`Increasing minimum to ${minimumBigInt.toString()} wei`)
    }

    await mutex.lock(async () => {
      if (backpressure) {
        minimumBigInt = minimumBigInt / 2n
        minimumBase16 = minimumBigInt.toString(16).padStart(64, "0")
        minimumZeroHex = `0x${minimumBase16}`

        console.log(`Decreasing minimum to ${minimumBigInt.toString()} wei`)
      }

      const nonce = await wallet.getNonce("latest")

      while (true) {
        const signal = AbortSignal.timeout(15000)
        const future = new Future<never>()

        const onAbort = () => future.reject(new Error("Aborted"))

        try {
          signal.addEventListener("abort", onAbort, { passive: true })

          console.log(`Claiming ${pendingTotalValueBigInt2.toString()} wei`)
          const responsePromise = contract.claim(nonceZeroHex, pendingSecretZeroHexArray2, { nonce })
          const response = await Promise.race([responsePromise, future.promise])

          console.log(`Waiting for ${response.hash} on ${response.nonce}`)
          const receipt = await Promise.race([response.wait(), future.promise])

          return receipt
        } catch (e: unknown) {
          if (signal.aborted)
            continue
          throw e
        } finally {
          signal.removeEventListener("abort", onAbort)
        }
      }
    })
  }

  const onHttpRequest = async (request: Request) => {
    const url = new URL(request.url)

    const session = url.searchParams.get("session")

    if (session == null)
      return new Response("Bad Request", { status: 400 })

    const columnsByUuid = new Map<string, Columns>()

    const onNetGet = async (_: RpcRequestInit) => {
      return { chainIdString, contractZeroHex, receiverZeroHex, nonceZeroHex, minimumZeroHex }
    }

    const onNetTip = async (rpcRequest: RpcRequestInit) => {
      const [secretZeroHex] = rpcRequest.params as [string]

      if (typeof secretZeroHex !== "string")
        throw new RpcInvalidParamsError()
      if (secretZeroHex.length !== 66)
        throw new RpcInvalidParamsError()
      if (allSecretZeroHexSet.has(secretZeroHex))
        throw new RpcInvalidParamsError()

      allSecretZeroHexSet.add(secretZeroHex)

      const secretBase16 = secretZeroHex.slice(2).padStart(64, "0")
      const secretMemory = base16_decode_mixed(secretBase16)

      const valueMemory = mixinStruct.verify_secret(secretMemory)
      const valueBase16 = base16_encode_lower(valueMemory)
      const valueZeroHex = `0x${valueBase16}`
      const valueBigInt = BigInt(valueZeroHex)

      if (valueBigInt < minimumBigInt)
        throw new RpcInvalidParamsError()

      const addedBigInt = valueBigInt - minimumBigInt

      const [balanceBigInt = 0n] = [balanceByUuid.get(session)]
      balanceByUuid.set(session, balanceBigInt + addedBigInt)

      console.log(`Received ${valueBigInt.toString()} wei`)

      pendingSecretZeroHexArray.push(secretZeroHex)
      pendingTotalValueBigInt += valueBigInt

      if (pendingSecretZeroHexArray.length > 640) {
        claim(pendingTotalValueBigInt, pendingSecretZeroHexArray).catch(warn)

        pendingSecretZeroHexArray = new Array<string>()
        pendingTotalValueBigInt = 0n
      }

      return addedBigInt.toString()
    }

    const onNetSignal = async (rpcRequest: RpcRequestInit) => {
      const [uuid, row] = rpcRequest.params as [string, Columns]

      if (typeof row !== "object")
        throw new RpcInvalidParamsError()
      if (Object.keys(row).length > 100)
        throw new RpcInvalidParamsError()

      let [balanceBigInt = 0n] = [balanceByUuid.get(session)]
      balanceBigInt = balanceBigInt - (2n ** 20n)
      balanceByUuid.set(session, balanceBigInt)

      if (balanceBigInt < 0n)
        return new Response("Payment Required", { status: 402 })

      const previous = columnsByUuid.get(uuid)

      if (previous != null)
        db.remove(previous)

      columnsByUuid.set(uuid, row)
      db.append(row)

      console.log(`Got signal for ${JSON.stringify(row)}`)
    }

    const onNetSearch = async (rpcRequest: RpcRequestInit) => {
      const [orders, filters] = rpcRequest.params as [Orders, Columns]

      if (typeof orders !== "object")
        throw new RpcInvalidParamsError()
      if (typeof filters !== "object")
        throw new RpcInvalidParamsError()
      if (Object.keys(orders).length > 100)
        throw new RpcInvalidParamsError()
      if (Object.keys(filters).length > 100)
        throw new RpcInvalidParamsError()

      let [balanceBigInt = 0n] = [balanceByUuid.get(session)]
      balanceBigInt = balanceBigInt - (2n ** 16n)
      balanceByUuid.set(session, balanceBigInt)

      if (balanceBigInt < 0n)
        return new Response("Payment Required", { status: 402 })

      return db.get(orders, filters)
    }

    if (request.headers.get("upgrade") !== "websocket") {
      if (request.method !== "POST")
        return new Response("Method Not Allowed", { status: 405 })

      const contentType = request.headers.get("content-type")

      if (contentType !== "application/json")
        return new Response("Unsupported Media Type", { status: 415 })

      const onRequest = async (request: RpcRequestInit) => {
        try {
          const option = await routeOrNone(request)

          if (option.isNone())
            return new RpcErr(request.id, new RpcMethodNotFoundError())

          return new RpcOk(request.id, option.get())
        } catch (e: unknown) {
          return new RpcErr(request.id, RpcError.rewrap(e))
        }
      }

      const routeOrNone = async (request: RpcRequestInit) => {
        if (request.method === "net_get")
          return new Some(await onNetGet(request))
        if (request.method === "net_tip")
          return new Some(await onNetTip(request))
        if (request.method === "net_search")
          return new Some(await onNetSearch(request))
        return new None()
      }

      const input = RpcRequest.from(await request.json())
      const output = await onRequest(input)

      const headers = { "content-type": "application/json" }
      const body = JSON.stringify(output)

      return new Response(body, { status: 200, headers })
    }

    const upgrade = Deno.upgradeWebSocket(request)

    const client = upgrade.socket

    const closeOrIgnore = () => {
      for (const columns of columnsByUuid.values())
        db.remove(columns)

      try {
        client.close()
      } catch { }
    }

    const onRequest = async (request: RpcRequestInit) => {
      try {
        const option = await routeAndOption(request)

        if (option.isNone())
          return new RpcErr(request.id, new RpcMethodNotFoundError())

        return new RpcOk(request.id, option.get())
      } catch (e: unknown) {
        return new RpcErr(request.id, RpcError.rewrap(e))
      }
    }

    const routeAndOption = async (request: RpcRequestInit) => {
      if (request.method === "net_get")
        return new Some(await onNetGet(request))
      if (request.method === "net_tip")
        return new Some(await onNetTip(request))
      if (request.method === "net_signal")
        return new Some(await onNetSignal(request))
      if (request.method === "net_search")
        return new Some(await onNetSearch(request))
      return new None()
    }

    const onClientMessageOrClose = async (message: string) => {
      try {
        const request = JSON.parse(message) as RpcRequestInit
        const response = await onRequest(request)

        client.send(JSON.stringify(response))
      } catch {
        closeOrIgnore()
      }
    }

    client.addEventListener("message", async (event) => {
      if (typeof event.data !== "string")
        return
      return await onClientMessageOrClose(event.data)
    })

    client.addEventListener("close", () => closeOrIgnore())

    return upgrade.response
  }

  return { onHttpRequest }
}