import { onMounted, onBeforeUnmount } from "#imports"


export default function useQueue(id: string){

    let ws: WebSocket | undefined;

    const subscribe = async () => {
        const isSecure = location.protocol === "https:"
        const url = (isSecure ? "wss://" : "ws://") + location.host + "/api/_queue/ws?id=" + id
        console.log("ws", "Connecting to", url, "...")
        ws = new WebSocket(url)
        ws.addEventListener("message", (event) => {
            const { eventType = "", job = {} } = JSON.parse(event.data)
            console.log(eventType, job)
        })
        await new Promise((resolve) => ws!.addEventListener("open", resolve))
    }

    onMounted(async ()=>{
        await subscribe()
    })

    onBeforeUnmount(()=>{
        ws?.close()
    })
}