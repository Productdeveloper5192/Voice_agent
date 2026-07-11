import { useEffect, useState, useRef } from 'react';
import {
  LiveKitRoom,
  RoomAudioRenderer,
  useTracks,
  VideoTrack,
  useRoomContext,
  useConnectionState,
  useDisconnectButton,
  TrackToggle,
} from '@livekit/components-react';
import { Track, ConnectionState, RoomEvent } from 'livekit-client';
import '@livekit/components-styles';
import './App.css';
import ToolVisualizer from './components/ToolVisualizer';

const showDebugTracks = import.meta.env.VITE_SHOW_DEBUG_TRACKS === "true";
const showAgentActivity = import.meta.env.VITE_SHOW_AGENT_ACTIVITY !== "false";

function App() {
  const [token, setToken] = useState("");
  const [tokenError, setTokenError] = useState("");
  const [isConnected, setIsConnected] = useState(false);
  const [hasEverConnected, setHasEverConnected] = useState(false);
  const userInitiatedDisconnect = useRef(false);
  const didFetch = useRef(false);

  const url = import.meta.env.VITE_LIVEKIT_URL;

  useEffect(() => {
    if (didFetch.current) return;
    didFetch.current = true;

    const backendUrl = import.meta.env.VITE_BACKEND_URL || "http://localhost:8000";
    fetch(`${backendUrl}/getToken?name=User`)
      .then(res => {
        if (!res.ok) throw new Error(`Token request failed: ${res.status}`);
        return res.json();
      })
      .then(data => {
        if (!data.token) throw new Error("Token response did not include a token");
        setToken(data.token);
      })
      .catch(error => {
        console.error("Unable to fetch LiveKit token:", error);
        setTokenError("Unable to start the consultation. Please check the backend server.");
      });
  }, []);

  if (tokenError) return <div className="loading">{tokenError}</div>;
  if (!token) return <div className="loading">Initializing Neural Interface...</div>;

  if (!isConnected) {
    return (
      <div className="pre-join-screen">
        <AgentAvatarVisual compact />
        <h1>Clinic Voice Assistant</h1>
        <button className="start-button" onClick={() => setIsConnected(true)}>
          Start Consultation
        </button>
      </div>
    );
  }

  const handleConnected = () => {
    setHasEverConnected(true);
  };

  const handleDisconnected = () => {
    if (userInitiatedDisconnect.current) {
      userInitiatedDisconnect.current = false;
      setIsConnected(false);
      setHasEverConnected(false);
      return;
    }

    if (!hasEverConnected) {
      setIsConnected(false);
    }
  };

  return (
    <LiveKitRoom
      video={false}
      audio={true}
      token={token}
      serverUrl={url}
      connect={true}
      data-lk-theme="default"
      className="lk-room-container"
      onConnected={handleConnected}
      onDisconnected={handleDisconnected}
    >
      <RoomContent setIsConnected={setIsConnected} userInitiatedDisconnect={userInitiatedDisconnect} />
    </LiveKitRoom>
  );
}

function RoomContent({ setIsConnected, userInitiatedDisconnect }: {
  setIsConnected: (v: boolean) => void;
  userInitiatedDisconnect: React.MutableRefObject<boolean>;
}) {
  const [permissionsGranted, setPermissionsGranted] = useState(false);
  const [systemStatus, setSystemStatus] = useState({
    stt: 'pending',
    llm: 'pending',
    tts: 'pending',
    database: 'pending',
    avatar: 'pending'
  });
  const [wasEverReady, setWasEverReady] = useState(false);
  const [readinessTimedOut, setReadinessTimedOut] = useState(false);

  const tracks = useTracks([Track.Source.Camera, Track.Source.Microphone]);
  const videoTrack = tracks.find(t => t.publication.kind === Track.Kind.Video);
  const room = useRoomContext();
  const connectionState = useConnectionState();

  useEffect(() => {
    if (!room) return;

    const handleDataReceived = (payload: Uint8Array) => {
      const message = new TextDecoder().decode(payload);

      try {
        const data = JSON.parse(message);
        if (data.type === 'system_status') {
          setSystemStatus(prev => ({
            ...prev,
            [data.component]: data.status
          }));
        }
      } catch {
        // Ignore non-JSON data-channel messages from third-party tracks.
      }
    };

    room.on(RoomEvent.DataReceived, handleDataReceived);
    return () => {
      room.off(RoomEvent.DataReceived, handleDataReceived);
    };
  }, [room]);

  useEffect(() => {
    if (connectionState !== ConnectionState.Connected || permissionsGranted) return;

    const requestPermissions = async () => {
      try {
        await navigator.mediaDevices.getUserMedia({ audio: true });

        try {
          await navigator.mediaDevices.getUserMedia({ video: true });
        } catch {
          // Camera is optional; the assistant can continue with audio only.
        }

        setPermissionsGranted(true);
      } catch (err) {
        console.error("Microphone access denied:", err);
        alert("Microphone access is required. Please allow microphone access and refresh.");
      }
    };

    requestPermissions();
  }, [connectionState, permissionsGranted]);

  useEffect(() => {
    if (wasEverReady || connectionState !== ConnectionState.Connected) return;

    const timeout = setTimeout(() => {
      console.warn("System readiness timed out; showing voice session fallback.");
      setReadinessTimedOut(true);
    }, 45000);

    return () => clearTimeout(timeout);
  }, [connectionState, wasEverReady]);

  const avatarReady = systemStatus.avatar === 'ready' && videoTrack !== undefined;
  const avatarUnavailable = systemStatus.avatar === 'unavailable' || systemStatus.avatar === 'error';
  const coreSystemsReady =
    systemStatus.stt === 'ready' &&
    systemStatus.llm === 'ready' &&
    systemStatus.tts === 'ready' &&
    systemStatus.database === 'ready';

  const allSystemsReady =
    connectionState === ConnectionState.Connected &&
    permissionsGranted &&
    ((coreSystemsReady && (avatarReady || avatarUnavailable)) || readinessTimedOut);

  useEffect(() => {
    if (allSystemsReady && !wasEverReady) {
      setWasEverReady(true);
    }
  }, [allSystemsReady, wasEverReady]);

  const isReconnecting = wasEverReady && connectionState === ConnectionState.Reconnecting;
  const isDisconnected = wasEverReady && connectionState === ConnectionState.Disconnected;

  useEffect(() => {
    if (!isDisconnected) return;

    const timeout = setTimeout(() => {
      setIsConnected(false);
    }, 30000);

    return () => clearTimeout(timeout);
  }, [isDisconnected, setIsConnected]);

  if (!allSystemsReady && !wasEverReady) {
    return (
      <div className="loading-screen-container">
        <div className="loading-content">
          <AgentAvatarVisual compact />

          <h2 style={{ marginBottom: '2rem' }}>Warming Up Systems</h2>

          <div className="system-status-list">
            <SystemStatusItem
              icon="MIC"
              label="Permissions"
              status={permissionsGranted ? 'ready' : 'pending'}
            />
            <SystemStatusItem
              icon="STT"
              label="Speech-to-Text"
              status={systemStatus.stt}
            />
            <SystemStatusItem
              icon="LLM"
              label="AI Model"
              status={systemStatus.llm}
            />
            <SystemStatusItem
              icon="TTS"
              label="Text-to-Speech"
              status={systemStatus.tts}
            />
            <SystemStatusItem
              icon="DB"
              label="Database"
              status={systemStatus.database}
            />
            <SystemStatusItem
              icon="AV"
              label="Avatar"
              status={videoTrack ? 'ready' : (systemStatus.avatar === 'ready' ? 'initializing' : systemStatus.avatar)}
            />
            {readinessTimedOut && (
              <SystemStatusItem icon="NET" label="Fallback" status="timeout" />
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      {(isReconnecting || isDisconnected) && (
        <div className="reconnecting-overlay">
          <div className="reconnecting-content">
            <div className="reconnecting-spinner">...</div>
            <h3>{isDisconnected ? 'Connection Lost' : 'Reconnecting...'}</h3>
            <p>{isDisconnected ? 'Attempting to reconnect...' : 'Please wait...'}</p>
          </div>
        </div>
      )}

      <div className="avatar-container">
        <AvatarRenderer />
      </div>

      <div className="controls">
        <RoomAudioRenderer />
        <CustomControlBar userInitiatedDisconnect={userInitiatedDisconnect} />
      </div>

      {showAgentActivity && <ToolVisualizer />}
      {showDebugTracks && <TrackDebug />}
    </>
  );
}

function SystemStatusItem({ icon, label, status }: { icon: string; label: string; status: string }) {
  const getStatusColor = () => {
    switch (status) {
      case 'ready': return '#00ff88';
      case 'initializing': return '#ffaa00';
      case 'error': return '#ff4444';
      case 'unavailable': return '#888888';
      case 'timeout': return '#ffaa00';
      default: return '#555555';
    }
  };

  const getStatusText = () => {
    switch (status) {
      case 'ready': return 'Ready';
      case 'initializing': return 'Loading...';
      case 'error': return 'Error';
      case 'unavailable': return '- Unavailable';
      case 'timeout': return 'Continuing';
      default: return 'Waiting...';
    }
  };

  return (
    <div className="status-item" style={{ color: getStatusColor() }}>
      <span className="status-icon">{icon}</span>
      <span className="status-label">{label}</span>
      <span className="status-text">{getStatusText()}</span>
    </div>
  );
}

function TrackDebug() {
  const tracks = useTracks();
  return (
    <div style={{ position: 'absolute', bottom: 10, left: 10, fontSize: '0.7em', color: '#555', zIndex: 100 }}>
      Tracks: {tracks.length} |
      {tracks.map(t => ` [${t.source}:${t.publication.kind}]`)}
    </div>
  );
}

function AvatarRenderer() {
  const tracks = useTracks([Track.Source.Camera, Track.Source.Microphone, Track.Source.ScreenShare]);

  const videoTrack = tracks.find(t => t.publication.kind === Track.Kind.Video);

  if (videoTrack) {
    return (
      <VideoTrack
        trackRef={videoTrack}
        className="avatar-video"
      />
    );
  }

  return (
    <div className="avatar-placeholder">
      <div className="avatar-fallback-content">
        <span className="avatar-fallback-icon">🎙️</span>
        <span>Clinic Voice Assistant</span>
      </div>
    </div>
  );
}

function AgentAvatarVisual({ compact = false }: { compact?: boolean }) {
  return (
    <div className={compact ? "agent-visual agent-visual-compact" : "agent-visual"}>
      <div className="agent-avatar-home">
        <div className="avatar-pulse-ring" />
        <div className="avatar-pulse-ring avatar-pulse-ring-2" />
        <div className="avatar-icon-circle">
          <svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className="avatar-medical-icon">
            <circle cx="32" cy="20" r="10" stroke="#00ff88" strokeWidth="2" fill="rgba(0,255,136,0.08)" />
            <path d="M16 52c0-8.837 7.163-16 16-16s16 7.163 16 16" stroke="#00ff88" strokeWidth="2" fill="rgba(0,255,136,0.05)" />
            <path d="M30 16v8M26 20h8" stroke="#00ff88" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </div>
        <span className="avatar-home-label">AI Assistant</span>
      </div>
    </div>
  );
}

function CustomControlBar({ userInitiatedDisconnect }: {
  userInitiatedDisconnect: React.MutableRefObject<boolean>;
}) {
  const { buttonProps } = useDisconnectButton({});

  const handleDisconnect = () => {
    userInitiatedDisconnect.current = true;
    buttonProps.onClick?.({} as React.MouseEvent<HTMLButtonElement>);
  };

  return (
    <div className="lk-control-bar">
      <TrackToggle source={Track.Source.Microphone} />
      <button
        className="lk-button lk-disconnect-button"
        onClick={handleDisconnect}
        title="Leave session"
      >
        Leave
      </button>
    </div>
  );
}

export default App;
