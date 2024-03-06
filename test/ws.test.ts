// deno-lint-ignore-file no-namespace require-await
import { Future } from "npm:@hazae41/future@1.0.3";
import { RpcCounter, RpcRequest, RpcRequestPreinit, RpcResponse, RpcResponseInit } from "npm:@hazae41/jsonrpc@1.0.5";
import { NetworkMixin, base16_decode_mixed, base16_encode_lower, initBundledOnce } from "npm:@hazae41/network-bundle@1.2.1";

await initBundledOnce()

export namespace WebSockets {

  export async function openOrThrow(url: string) {
    const socket = new WebSocket(url)
    const future = new Future<void>()

    const onOpen = () => {
      future.resolve()
    }

    const onError = (event: Event) => {
      future.reject(new Error("Errored", { cause: event }))
    }

    const onClose = (event: CloseEvent) => {
      future.reject(new Error("Closed", { cause: event }))
    }

    try {
      socket.addEventListener("open", onOpen, { passive: true })
      socket.addEventListener("error", onError, { passive: true })
      socket.addEventListener("close", onClose, { passive: true })

      await future.promise

      return socket
    } finally {
      socket.removeEventListener("open", onOpen)
      socket.removeEventListener("error", onError)
      socket.removeEventListener("close", onClose)
    }
  }

}

export interface NetworkParams {
  readonly chainIdString: string,
  readonly contractZeroHex: string,
  readonly receiverZeroHex: string,
  readonly nonceZeroHex: string,
  readonly minimumZeroHex: string
}


export class NetworkSession {

  readonly uuid = crypto.randomUUID()

  balance = 0n

  constructor() { }

}

export class PricePerRequestNetworkSocket {

  readonly events = new EventTarget()

  #counter = new RpcCounter()

  #onClean: () => void

  constructor(
    readonly session: NetworkSession,
    readonly socket: WebSocket
  ) {
    const onMessage = (event: MessageEvent<unknown>) => {
      this.#onMessage(event)
    }

    const onCloseOrError = () => {
      this.#onClean()
    }

    socket.addEventListener("message", onMessage, { passive: true })
    socket.addEventListener("close", onCloseOrError, { passive: true })
    socket.addEventListener("error", onCloseOrError, { passive: true })

    this.#onClean = () => {
      socket.removeEventListener("message", onMessage)
      socket.removeEventListener("close", onCloseOrError)
      socket.removeEventListener("error", onCloseOrError)

      this.#onClean = () => { }
    }
  }

  [Symbol.dispose]() {
    this.socket.close()
  }

  async requestOrThrow<T>(reqinit: RpcRequestPreinit<unknown>, price: bigint) {
    const request = this.#counter.prepare(reqinit)
    const message = JSON.stringify(request)

    if (this.session.balance < price)
      await this.#refill(price)

    this.session.balance -= price

    const future = new Future<RpcResponse<T>>()

    const onResponse = (event: Event) => {
      const response = (event as CustomEvent<RpcResponseInit<T>>).detail

      if (response.id !== request.id)
        return
      future.resolve(RpcResponse.from(response))
    }

    const onError = (event: Event) => {
      future.reject(new Error("Errored", { cause: event }))
    }

    const onClose = (event: CloseEvent) => {
      future.reject(new Error("Closed", { cause: event }))
    }

    try {
      this.events.addEventListener("response", onResponse, { passive: true })
      this.socket.addEventListener("error", onError, { passive: true })
      this.socket.addEventListener("close", onClose, { passive: true })

      this.socket.send(message)

      return await future.promise
    } finally {
      this.events.removeEventListener("response", onResponse)
      this.socket.removeEventListener("error", onError)
      this.socket.removeEventListener("close", onClose)
    }
  }

  async #refill(price: bigint) {
    await initBundledOnce()

    const {
      chainIdString,
      contractZeroHex,
      receiverZeroHex,
      nonceZeroHex,
      minimumZeroHex
    } = await this.requestOrThrow<NetworkParams>({
      method: "net_get"
    }, 0n).then(r => r.unwrap())

    const minimumBigInt = BigInt(minimumZeroHex)

    if (minimumBigInt > (2n ** 24n))
      throw new Error("Minimum too high")

    const minimumBase16 = minimumZeroHex.slice(2).padStart(64, "0")
    const minimumMemory = base16_decode_mixed(minimumBase16)

    const chainIdBase16 = Number(chainIdString).toString(16).padStart(64, "0")
    const chainIdMemory = base16_decode_mixed(chainIdBase16)

    const contractBase16 = contractZeroHex.slice(2).padStart(64, "0")
    const contractMemory = base16_decode_mixed(contractBase16)

    const receiverBase16 = receiverZeroHex.slice(2).padStart(64, "0")
    const receiverMemory = base16_decode_mixed(receiverBase16)

    const nonceBase16 = nonceZeroHex.slice(2).padStart(64, "0")
    const nonceMemory = base16_decode_mixed(nonceBase16)

    const mixin = new NetworkMixin(chainIdMemory, contractMemory, receiverMemory, nonceMemory)

    while (this.session.balance < price) {
      const generatedStruct = mixin.generate(minimumMemory)

      const secretMemory = generatedStruct.to_secret()
      const secretBase16 = base16_encode_lower(secretMemory)
      const secretZeroHex = `0x${secretBase16}`

      this.session.balance += await this.requestOrThrow<string>({ method: "net_tip", params: [secretZeroHex] }, 0n).then(r => BigInt(r.unwrap()))
    }
  }

  async #onMessage(event: MessageEvent<unknown>) {
    if (typeof event.data !== "string")
      return

    const requestOrResponse = JSON.parse(event.data) as RpcRequest<unknown> | RpcResponse<unknown>

    if ("method" in requestOrResponse)
      return
    const response = requestOrResponse

    return void await this.#onResponse(response)
  }

  async #onResponse(response: RpcResponse<unknown>) {
    this.events.dispatchEvent(new CustomEvent("response", { detail: response }))
  }

}

const session = new NetworkSession()
const socket = await WebSockets.openOrThrow(`ws://localhost:8080/?session=${session}`)
const client = new PricePerRequestNetworkSocket(session, socket)

console.log(await client.requestOrThrow<unknown>({ method: "net_search", params: [{}, { jsonRpcProtocols: ["eip155:1"] }] }, (2n ** 16n)))

client.socket.close()