import { useRoomContext } from '@livekit/components-react';
import { useEffect, useState } from 'react';
import { RoomEvent } from 'livekit-client';

export default function ToolVisualizer() {
  const room = useRoomContext();
  const [status, setStatus] = useState("Ready for appointment requests");
  const [history, setHistory] = useState<string[]>([]);

  useEffect(() => {
    if (!room) return;

    const handleData = (payload: Uint8Array) => {
      const str = new TextDecoder().decode(payload);
      try {
        const msg = JSON.parse(str);
        if (msg.type === "tool_call") {
          setStatus(msg.message);
          setHistory(prev => [`Started: ${msg.message}`, ...prev].slice(0, 5));
        } else if (msg.type === "tool_result") {
          setStatus(msg.message);
          setHistory(prev => [`Completed: ${msg.message}`, ...prev].slice(0, 5));
        }
      } catch {
        // Ignore non-JSON room messages.
      }
    };

    room.on(RoomEvent.DataReceived, handleData);
    return () => {
      room.off(RoomEvent.DataReceived, handleData);
    };
  }, [room]);

  return (
    <section className="tool-visualizer" aria-label="Assistant activity">
      <div className="tool-visualizer-header">
        <span className="activity-dot" />
        <h2>Live Workflow</h2>
      </div>
      <div className="current-status">{status}</div>
      {history.length > 0 && (
        <div className="history">
          {history.map((item, index) => <div key={`${item}-${index}`}>{item}</div>)}
        </div>
      )}
    </section>
  );
}
