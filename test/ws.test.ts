import { RpcCounter, RpcRequest, RpcRequestPreinit, RpcResponse, RpcResponseInit } from "npm:@hazae41/jsonrpc@1.0.5";
import { NetworkMixin, base16_decode_mixed, base16_encode_lower, initBundledOnce } from "npm:@hazae41/network-bundle@1.2.1";

await initBundledOnce()

while (true) {
  const session = crypto.randomUUID()

  const socket = new WebSocket(`ws://localhost:8080/?session=${session}`)

  await new Promise((ok, err) => {
    socket.addEventListener("open", ok)
    socket.addEventListener("error", err)
  })

  const counter = new RpcCounter()
  const events = new EventTarget()

  const onRequest = (request: RpcRequest<unknown>, length: number) => {
    events.dispatchEvent(new CustomEvent("request", { detail: [request, length] }))
  }

  const onResponse = (response: RpcResponse<unknown>, length: number) => {
    events.dispatchEvent(new CustomEvent("response", { detail: [response, length] }))
  }

  const onMessage = (message: string) => {
    const requestOrResponse = JSON.parse(message) as RpcRequest<unknown> | RpcResponse

    if ("method" in requestOrResponse)
      return onRequest(requestOrResponse, message.length)

    return onResponse(requestOrResponse, message.length)
  }

  socket.addEventListener("message", (event) => {
    if (typeof event.data !== "string")
      return
    return onMessage(event.data)
  })

  const requestOrThrow = async <T>(preinit: RpcRequestPreinit<unknown>, count = true) => {
    const request = counter.prepare(preinit)
    const message = JSON.stringify(request)

    if (count) {
      balanceBigInt -= BigInt(message.length)

      while (balanceBigInt < 65536n)
        await net_tip()

      socket.send(message)
    } else {
      socket.send(message)
    }

    return await new Promise<RpcResponse<T>>(ok => {
      const onResponse = async (event: Event) => {
        const [response, length] = (event as CustomEvent<[RpcResponseInit<T>, number]>).detail

        if (response.id !== request.id)
          return

        if (count) {
          balanceBigInt -= BigInt(length)

          while (balanceBigInt < 65536n)
            await net_tip()
          ok(RpcResponse.from(response))
        } else {
          ok(RpcResponse.from(response))
        }
      }

      events.addEventListener("response", onResponse)
    })
  }

  let balanceBigInt = 0n

  const net_tip = async () => {
    const {
      chainIdString,
      contractZeroHex,
      receiverZeroHex,
      nonceZeroHex,
      minimumZeroHex
    } = await requestOrThrow<{
      chainIdString: string,
      contractZeroHex: string,
      receiverZeroHex: string,
      nonceZeroHex: string,
      minimumZeroHex: string
    }>({
      method: "net_get"
    }, false).then(r => r.unwrap())

    // const minimumBigInt = BigInt(minimumZeroHex)

    // if (minimumBigInt > (2n ** 20n))
    //   throw new Error("Minimum too high")

    const chainIdBase16 = Number(chainIdString).toString(16).padStart(64, "0")
    const chainIdMemory = base16_decode_mixed(chainIdBase16)

    const contractBase16 = contractZeroHex.slice(2).padStart(64, "0")
    const contractMemory = base16_decode_mixed(contractBase16)

    const receiverBase16 = receiverZeroHex.slice(2).padStart(64, "0")
    const receiverMemory = base16_decode_mixed(receiverBase16)

    const nonceBase16 = nonceZeroHex.slice(2).padStart(64, "0")
    const nonceMemory = base16_decode_mixed(nonceBase16)

    const mixinStruct = new NetworkMixin(chainIdMemory, contractMemory, receiverMemory, nonceMemory)

    const minimumBase16 = minimumZeroHex.slice(2).padStart(64, "0")
    const minimumMemory = base16_decode_mixed(minimumBase16)

    const generatedStruct = mixinStruct.generate(minimumMemory)

    const secretMemory = generatedStruct.to_secret()
    const secretBase16 = base16_encode_lower(secretMemory)
    const secretZeroHex = `0x${secretBase16}`

    balanceBigInt += await requestOrThrow<string>({ method: "net_tip", params: [secretZeroHex] }, false).then(r => BigInt(r.unwrap()))
  }

  console.log(await requestOrThrow<unknown>({ method: "eth_blockNumber", params: [] }))
}