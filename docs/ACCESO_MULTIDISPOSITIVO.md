# Acceso Multi-Dispositivo para Streaming de Cámaras

## 📱 Cómo Acceder desde Diferentes Dispositivos

MediaMTX proporciona múltiples protocolos para diferentes tipos de dispositivos:

---

## 1. 🌐 Navegador Web (PC/Mac/Móvil)

### Opción A: HLS (HTTP Live Streaming) - Recomendado

**Compatibilidad**: ✅ Todos los navegadores modernos, iOS, Android

**URL de Acceso**:
```
http://localhost:8888/cam-principal
```

**Ejemplo de HTML simple**:
```html
<!DOCTYPE html>
<html>
<head>
    <title>Cámara en Vivo</title>
</head>
<body>
    <h1>Monitoreo de Cámara</h1>

    <!-- Opción 1: Video nativo HTML5 -->
    <video controls autoplay muted width="100%">
        <source src="http://localhost:8888/cam-principal/index.m3u8" type="application/x-mpegURL">
        Tu navegador no soporta HLS
    </video>

    <!-- Opción 2: Con HLS.js (mejor compatibilidad) -->
    <script src="https://cdn.jsdelivr.net/npm/hls.js@latest"></script>
    <video id="video" controls autoplay muted width="100%"></video>
    <script>
        const video = document.getElementById('video');
        const src = 'http://localhost:8888/cam-principal/index.m3u8';

        if (video.canPlayType('application/vnd.apple.mpegurl')) {
            // Soporte nativo HLS (Safari)
            video.src = src;
        } else if (Hls.isSupported()) {
            // Otros navegadores con HLS.js
            const hls = new Hls();
            hls.loadSource(src);
            hls.attachMedia(video);
        }
    </script>
</body>
</html>
```

**Características HLS**:
- ✅ Latencia: 3-10 segundos
- ✅ Compatible con todos los dispositivos
- ✅ Adaptativo (ajusta calidad según conexión)
- ✅ Funciona sobre HTTP/HTTPS estándar

---

### Opción B: WebRTC (Baja Latencia) - Para aplicaciones interactivas

**Compatibilidad**: ✅ Chrome, Firefox, Edge, Safari

**URL de Acceso**:
```
http://localhost:8889/cam-principal
```

**Ejemplo con WebRTC**:
```html
<!DOCTYPE html>
<html>
<head>
    <title>Cámara WebRTC</title>
</head>
<body>
    <h1>Vista en Vivo (Baja Latencia)</h1>
    <video id="video" controls autoplay playsinline width="100%"></video>

    <script>
    const pc = new RTCPeerConnection({
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    });

    pc.ontrack = (event) => {
        document.getElementById('video').srcObject = event.streams[0];
    };

    pc.addTransceiver('video', { direction: 'recvonly' });

    pc.createOffer().then(offer => {
        pc.setLocalDescription(offer);

        return fetch('http://localhost:8889/cam-principal/whep', {
            method: 'POST',
            headers: { 'Content-Type': 'application/sdp' },
            body: offer.sdp
        });
    }).then(res => res.text()).then(sdp => {
        pc.setRemoteDescription(new RTCSessionDescription({
            type: 'answer',
            sdp: sdp
        }));
    });
    </script>
</body>
</html>
```

**Características WebRTC**:
- ✅ Latencia: < 1 segundo
- ✅ Ideal para aplicaciones interactivas
- ⚠️ Más complejo de configurar con túneles

---

## 2. 📱 Aplicaciones Móviles (iOS/Android)

### iOS (Swift)

**Usando AVPlayer para HLS**:
```swift
import AVKit
import AVFoundation

class CameraViewController: UIViewController {
    var player: AVPlayer?

    override func viewDidLoad() {
        super.viewDidLoad()

        // URL del stream HLS
        let url = URL(string: "http://TU-SERVIDOR:8888/cam-principal/index.m3u8")!

        player = AVPlayer(url: url)

        let playerLayer = AVPlayerLayer(player: player)
        playerLayer.frame = view.bounds
        view.layer.addSublayer(playerLayer)

        player?.play()
    }
}
```

### Android (Kotlin)

**Usando ExoPlayer para HLS**:
```kotlin
import com.google.android.exoplayer2.ExoPlayer
import com.google.android.exoplayer2.MediaItem
import com.google.android.exoplayer2.ui.PlayerView

class CameraActivity : AppCompatActivity() {
    private var player: ExoPlayer? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_camera)

        player = ExoPlayer.Builder(this).build()

        val playerView: PlayerView = findViewById(R.id.player_view)
        playerView.player = player

        val mediaItem = MediaItem.fromUri("http://TU-SERVIDOR:8888/cam-principal/index.m3u8")
        player?.setMediaItem(mediaItem)
        player?.prepare()
        player?.play()
    }

    override fun onDestroy() {
        super.onDestroy()
        player?.release()
    }
}
```

**build.gradle (dependencies)**:
```gradle
implementation 'com.google.android.exoplayer:exoplayer:2.19.1'
```

---

## 3. 🖥️ Aplicaciones de Escritorio

### VLC Media Player (Windows/Mac/Linux)

**Pasos**:
1. Abrir VLC
2. Media → Open Network Stream
3. Ingresar URL:
   ```
   rtsp://localhost:8554/cam-principal
   ```
4. Play

### OBS Studio (Para Grabación/Streaming)

**Configuración**:
1. Agregar Fuente → Media Source
2. Desmarcar "Local File"
3. Input: `rtsp://localhost:8554/cam-principal`
4. ✅ Restart playback when source becomes active

---

## 4. 🔌 Integración con Software Personalizado

### Python + OpenCV

```python
import cv2

# Conectar al stream RTSP
stream_url = "rtsp://localhost:8554/cam-principal"
cap = cv2.VideoCapture(stream_url)

while True:
    ret, frame = cap.read()

    if not ret:
        print("Error al recibir frame")
        break

    # Procesar frame (detección, análisis, etc.)
    cv2.imshow('Camara en Vivo', frame)

    if cv2.waitKey(1) & 0xFF == ord('q'):
        break

cap.release()
cv2.destroyAllWindows()
```

### Node.js + FFmpeg

```javascript
const { spawn } = require('child_process');

const ffmpeg = spawn('ffmpeg', [
    '-i', 'rtsp://localhost:8554/cam-principal',
    '-f', 'image2pipe',
    '-pix_fmt', 'rgb24',
    '-vcodec', 'rawvideo',
    '-'
]);

ffmpeg.stdout.on('data', (data) => {
    // Procesar frames
    console.log('Frame recibido:', data.length, 'bytes');
});

ffmpeg.stderr.on('data', (data) => {
    console.log('FFmpeg:', data.toString());
});
```

---

## 5. 📊 URLs de Acceso por Protocolo

Asumiendo que MediaMTX corre en `localhost`:

| Protocolo | URL | Uso Recomendado | Latencia |
|-----------|-----|-----------------|----------|
| **RTSP** | `rtsp://localhost:8554/cam-principal` | Software profesional, VLC, OBS | 1-2s |
| **HLS** | `http://localhost:8888/cam-principal` | Navegadores web, móviles | 3-10s |
| **WebRTC** | `http://localhost:8889/cam-principal` | Aplicaciones web interactivas | <1s |
| **RTMP** | `rtmp://localhost:1935/cam-principal` | Streaming a plataformas (YouTube, Twitch) | 2-5s |

---

## 6. 🔐 Autenticación en Clientes

Si habilitaste autenticación en MediaMTX:

### URL con Autenticación:
```
# RTSP
rtsp://usuario:password@localhost:8554/cam-principal

# HLS (pasar en headers)
fetch('http://localhost:8888/cam-principal/index.m3u8', {
    headers: {
        'Authorization': 'Basic ' + btoa('usuario:password')
    }
})
```

---

## 7. 🚀 Cliente Web Completo (React Example)

```jsx
import React, { useRef, useEffect } from 'react';
import Hls from 'hls.js';

function CameraPlayer({ streamUrl }) {
    const videoRef = useRef(null);

    useEffect(() => {
        const video = videoRef.current;

        if (Hls.isSupported()) {
            const hls = new Hls({
                enableWorker: true,
                lowLatencyMode: true,
            });

            hls.loadSource(streamUrl);
            hls.attachMedia(video);

            hls.on(Hls.Events.MANIFEST_PARSED, () => {
                video.play();
            });

            return () => {
                hls.destroy();
            };
        } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
            video.src = streamUrl;
            video.addEventListener('loadedmetadata', () => {
                video.play();
            });
        }
    }, [streamUrl]);

    return (
        <video
            ref={videoRef}
            controls
            autoPlay
            muted
            style={{ width: '100%', maxWidth: '1920px' }}
        />
    );
}

// Uso
function App() {
    return (
        <div>
            <h1>Monitoreo de Cámaras</h1>
            <CameraPlayer streamUrl="http://localhost:8888/cam-principal/index.m3u8" />
        </div>
    );
}

export default App;
```

---

## 8. 📋 Checklist de Implementación

- [ ] MediaMTX configurado y corriendo
- [ ] Cámara Hikvision configurada con RTSP
- [ ] Stream visible en VLC localmente
- [ ] Cliente web HTML/React funcionando
- [ ] Túnel configurado (Cloudflare/Ngrok)
- [ ] SSL/TLS habilitado (si es público)
- [ ] Autenticación habilitada
- [ ] Probado en móvil (iOS/Android)
- [ ] Documentación para clientes

---

## 🆘 Troubleshooting Común

### "No se puede reproducir el video"
- Verificar que MediaMTX esté corriendo
- Verificar que la URL sea correcta
- Revisar console del navegador para errores

### "CORS Error" en navegador
Agregar a `mediamtx.yml`:
```yaml
hlsAllowOrigin: "*"
webrtcAllowOrigin: "*"
```

### Latencia muy alta
- Usar WebRTC en vez de HLS
- Reducir buffer: `hlsPartDuration: 200ms`
- Usar sub-stream de la cámara (menor resolución)

### Stream se corta
- Verificar conexión de red
- Aumentar buffer en cliente
- Verificar recursos del servidor (CPU/RAM)

