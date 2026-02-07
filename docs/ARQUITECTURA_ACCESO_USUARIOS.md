# Arquitectura de Acceso para Usuarios y Administradores

## 🎯 Casos de Uso

### 1. **Usuario Final (Cliente)**
- Accede vía navegador web o app Android
- Inicia sesión con usuario/contraseña
- Ve SOLO sus cámaras
- Puede ver streams en vivo
- Puede ver grabaciones (si están habilitadas)

### 2. **Administrador**
- Accede al dashboard central
- Ve lista de TODOS los clientes
- Puede ver cámaras de cualquier cliente
- Ve estadísticas del sistema
- Gestiona usuarios y permisos

---

## 🏗️ Arquitectura del Sistema

```
┌────────────────────────────────────────────────────┐
│               INTERNET / IP PÚBLICA                 │
│         https://motorcontrol.tudominio.com         │
└──────────────────────┬─────────────────────────────┘
                       │
        ┌──────────────┴──────────────┐
        │                             │
        ↓                             ↓
┌───────────────┐            ┌─────────────────┐
│ Usuario       │            │ Administrador   │
│ cliente001    │            │ admin@empresa   │
│               │            │                 │
│ Android App   │            │ Dashboard Web   │
│ o Navegador   │            │                 │
└───────┬───────┘            └────────┬────────┘
        │                             │
        │ POST /api/auth/login       │ POST /api/admin/auth/login
        │ GET  /api/cameras          │ GET  /api/admin/cameras/all
        │ GET  /api/stream/:cameraId │ GET  /api/admin/clients
        │                             │
        └─────────────┬───────────────┘
                      │
                      ↓
        ┌─────────────────────────────┐
        │  SERVIDOR CENTRAL           │
        │  (Raspberry Pi)             │
        │  192.168.100.49             │
        │                             │
        │  ┌───────────────────────┐  │
        │  │ Node.js Backend       │  │
        │  │ - Express API         │  │
        │  │ - JWT Auth            │  │
        │  │ - Stream Proxy        │  │
        │  │ - MQTT Listener       │  │
        │  └───────────────────────┘  │
        │                             │
        │  ┌───────────────────────┐  │
        │  │ PostgreSQL            │  │
        │  │ - users               │  │
        │  │ - clients             │  │
        │  │ - cameras             │  │
        │  │ - recordings          │  │
        │  └───────────────────────┘  │
        │                             │
        │  ┌───────────────────────┐  │
        │  │ Mosquitto MQTT        │  │
        │  │ Port: 1885            │  │
        │  └───────────────────────┘  │
        └─────────────┬───────────────┘
                      │ MQTT
            ┌─────────┼─────────┐
            │         │         │
            ↓         ↓         ↓
    ┌───────────┐ ┌───────────┐ ┌───────────┐
    │ Cliente 1  │ │ Cliente 2  │ │ Cliente N  │
    │ Edge GW    │ │ Edge GW    │ │ Edge GW    │
    │            │ │            │ │            │
    │ MediaMTX   │ │ MediaMTX   │ │ MediaMTX   │
    │ + Cámaras  │ │ + Cámaras  │ │ + Cámaras  │
    └───────────┘ └───────────┘ └───────────┘
```

---

## 🔐 Sistema de Autenticación y Autorización

### Modelo de Datos

```sql
-- Tabla de usuarios (clientes y admins)
CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role VARCHAR(20) NOT NULL, -- 'user' o 'admin'
  client_id VARCHAR(100),     -- NULL para admins, ID del cliente para users
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Tabla de clientes (cada edge gateway)
CREATE TABLE clients (
  id VARCHAR(100) PRIMARY KEY,  -- 'edge-gateway-001'
  name VARCHAR(255) NOT NULL,   -- 'Casa Cliente 001'
  location VARCHAR(255),
  mqtt_username VARCHAR(100),
  status VARCHAR(20),           -- 'active', 'offline', 'suspended'
  last_heartbeat TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Tabla de cámaras
CREATE TABLE cameras (
  id SERIAL PRIMARY KEY,
  client_id VARCHAR(100) REFERENCES clients(id),
  camera_id VARCHAR(100) NOT NULL,  -- 'cam-principal'
  name VARCHAR(255),
  model VARCHAR(100),
  ip VARCHAR(50),
  rtsp_url TEXT,
  status VARCHAR(20),           -- 'online', 'offline'
  last_seen TIMESTAMP,
  streams JSONB,                -- URLs de streams (HLS, RTSP, WebRTC)
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(client_id, camera_id)
);

-- Tabla de grabaciones
CREATE TABLE recordings (
  id SERIAL PRIMARY KEY,
  camera_id INTEGER REFERENCES cameras(id),
  client_id VARCHAR(100) REFERENCES clients(id),
  file_path TEXT NOT NULL,
  file_size_mb FLOAT,
  duration_seconds INTEGER,
  started_at TIMESTAMP NOT NULL,
  ended_at TIMESTAMP,
  thumbnail_url TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);
```

---

## 🔑 Flujo de Autenticación

### Para Usuarios (Clientes)

```javascript
// 1. Login
POST /api/auth/login
Body: {
  "email": "cliente001@example.com",
  "password": "password123"
}

Response: {
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "user": {
    "id": 1,
    "email": "cliente001@example.com",
    "role": "user",
    "client_id": "edge-gateway-001"
  }
}

// 2. Obtener MIS cámaras
GET /api/cameras
Headers: {
  "Authorization": "Bearer <token>"
}

Response: {
  "cameras": [
    {
      "id": 1,
      "name": "Cámara Principal",
      "status": "online",
      "streams": {
        "hls": "/api/stream/1/hls",
        "rtsp": "rtsp://...",
        "webrtc": "/api/stream/1/webrtc"
      }
    }
  ]
}

// 3. Ver stream (proxy desde edge)
GET /api/stream/:cameraId/hls
Headers: {
  "Authorization": "Bearer <token>"
}

// El servidor valida:
// - Token válido
// - Usuario tiene acceso a esa cámara
// - Proxy el stream desde el edge gateway del cliente
```

### Para Administradores

```javascript
// 1. Login Admin
POST /api/admin/auth/login
Body: {
  "email": "admin@motorcontrol.com",
  "password": "admin_password"
}

Response: {
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "user": {
    "id": 2,
    "email": "admin@motorcontrol.com",
    "role": "admin"
  }
}

// 2. Ver todos los clientes
GET /api/admin/clients
Headers: {
  "Authorization": "Bearer <admin-token>"
}

Response: {
  "clients": [
    {
      "id": "edge-gateway-001",
      "name": "Casa Cliente 001",
      "location": "Guadalajara",
      "status": "online",
      "cameras": 3,
      "last_heartbeat": "2024-02-06T15:30:00Z"
    },
    {
      "id": "edge-gateway-002",
      "name": "Empresa Cliente 002",
      "location": "CDMX",
      "status": "offline",
      "cameras": 5,
      "last_heartbeat": "2024-02-06T14:00:00Z"
    }
  ]
}

// 3. Ver cámaras de un cliente específico
GET /api/admin/cameras/client/:clientId
Headers: {
  "Authorization": "Bearer <admin-token>"
}

// 4. Ver stream de cualquier cámara
GET /api/admin/stream/:clientId/:cameraId/hls
Headers: {
  "Authorization": "Bearer <admin-token>"
}
```

---

## 🎥 Sistema de Proxy de Streams

El servidor central actúa como **proxy** de los streams para:
- ✅ Centralizar autenticación
- ✅ Ocultar IPs de los edge gateways
- ✅ Controlar acceso por usuario
- ✅ Estadísticas centralizadas

### Implementación del Proxy

```javascript
// En el servidor central (MotorControlAPI)
// src/routes/stream.js

const express = require('express');
const axios = require('axios');
const { auth } = require('../middlewares/auth');
const Camera = require('../models/Camera');

const router = express.Router();

// Proxy para usuarios (solo sus cámaras)
router.get('/stream/:cameraId/hls', auth, async (req, res) => {
  try {
    const { cameraId } = req.params;
    const userId = req.user.id;
    const userClientId = req.user.client_id;

    // Verificar que la cámara pertenece al usuario
    const camera = await Camera.findOne({
      where: {
        id: cameraId,
        client_id: userClientId
      }
    });

    if (!camera) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Obtener información del edge gateway
    const edgeGateway = await getEdgeGatewayInfo(camera.client_id);

    // Proxy el stream desde el edge
    const streamUrl = `http://${edgeGateway.ip}:8888/${camera.camera_id}/index.m3u8`;

    // Opción A: Redirect
    // res.redirect(streamUrl);

    // Opción B: Stream proxy (mejor para control)
    const response = await axios.get(streamUrl, {
      responseType: 'stream'
    });

    res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
    response.data.pipe(res);

  } catch (error) {
    console.error('Stream proxy error:', error);
    res.status(500).json({ error: 'Stream unavailable' });
  }
});

// Proxy para admin (todas las cámaras)
router.get('/admin/stream/:clientId/:cameraId/hls', auth, adminOnly, async (req, res) => {
  try {
    const { clientId, cameraId } = req.params;

    const camera = await Camera.findOne({
      where: {
        client_id: clientId,
        camera_id: cameraId
      }
    });

    if (!camera) {
      return res.status(404).json({ error: 'Camera not found' });
    }

    const edgeGateway = await getEdgeGatewayInfo(clientId);
    const streamUrl = `http://${edgeGateway.ip}:8888/${camera.camera_id}/index.m3u8`;

    const response = await axios.get(streamUrl, {
      responseType: 'stream'
    });

    res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
    response.data.pipe(res);

  } catch (error) {
    console.error('Admin stream proxy error:', error);
    res.status(500).json({ error: 'Stream unavailable' });
  }
});

// Helper: Obtener info del edge gateway
async function getEdgeGatewayInfo(clientId) {
  // Esto vendría de tu BD o caché
  // Incluye IP del edge (puede ser IP privada de VPN)
  const client = await Client.findByPk(clientId);

  return {
    ip: client.vpn_ip || client.public_ip,  // Usar IP de VPN si está disponible
    port: 8888
  };
}

module.exports = router;
```

---

## 📱 App Android - Arquitectura

### Flujo de la App

```
1. Login Screen
   ↓
   POST /api/auth/login
   ↓ Recibe JWT token

2. Lista de Cámaras
   ↓
   GET /api/cameras
   ↓ Muestra cámaras del cliente

3. Vista de Stream
   ↓
   ExoPlayer carga: /api/stream/:cameraId/hls
   ↓ Stream en vivo

4. Grabaciones (opcional)
   ↓
   GET /api/recordings
   ↓ Lista de grabaciones disponibles
```

### Endpoints Necesarios para App Android

```javascript
// API para la app móvil

// 1. Login
POST /api/mobile/auth/login
Body: { email, password }
Response: { token, user }

// 2. Listar cámaras
GET /api/mobile/cameras
Headers: { Authorization: Bearer <token> }
Response: { cameras: [...] }

// 3. Stream HLS (compatible con ExoPlayer)
GET /api/mobile/stream/:cameraId/hls
Headers: { Authorization: Bearer <token> }
Response: Playlist M3U8

// 4. Stream WebRTC (baja latencia)
GET /api/mobile/stream/:cameraId/webrtc
Headers: { Authorization: Bearer <token> }
Response: WebRTC offer/answer

// 5. Grabaciones
GET /api/mobile/recordings
Query: ?date=2024-02-06
Headers: { Authorization: Bearer <token> }
Response: { recordings: [...] }

// 6. Notificaciones Push
POST /api/mobile/register-token
Body: { fcm_token }
Headers: { Authorization: Bearer <token> }
Response: { success: true }
```

---

## 🌐 Acceso de Usuarios - Opciones

### Opción 1: Dominio Público (Recomendado)

```
https://motorcontrol.tudominio.com

├─ /              → Landing page
├─ /login         → Login de usuarios
├─ /dashboard     → Vista de cámaras (user)
├─ /admin         → Dashboard admin
└─ /api           → API REST
```

**Configuración**:
1. Registrar dominio
2. Apuntar DNS a tu IP pública
3. Configurar Nginx con SSL (Let's Encrypt)

```nginx
# /etc/nginx/sites-available/motorcontrol

server {
    listen 80;
    listen 443 ssl;
    server_name motorcontrol.tudominio.com;

    ssl_certificate /etc/letsencrypt/live/motorcontrol.tudominio.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/motorcontrol.tudominio.com/privkey.pem;

    # Redirigir HTTP a HTTPS
    if ($scheme != "https") {
        return 301 https://$server_name$request_uri;
    }

    # API Backend
    location /api {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }

    # Frontend estático
    location / {
        root /var/www/motorcontrol-frontend;
        try_files $uri $uri/ /index.html;
    }
}
```

### Opción 2: Solo IP Pública (Temporal)

```
http://TU-IP-PUBLICA:80

- Funciona para pruebas
- No es profesional para producción
- Sin HTTPS (inseguro para passwords)
```

---

## 🎨 Dashboard Admin vs Dashboard Usuario

### Dashboard Usuario (Cliente)

**URL**: `https://motorcontrol.tudominio.com/dashboard`

**Vistas**:
```
┌─────────────────────────────────────┐
│  Dashboard - Casa Cliente 001       │
├─────────────────────────────────────┤
│  🎥 Mis Cámaras                     │
│                                     │
│  📹 Cámara Principal                │
│  ● Online | Ver en vivo            │
│                                     │
│  📹 Cámara Patio                    │
│  ● Online | Ver en vivo            │
│                                     │
│  📹 Cámara Garage                   │
│  ⚫ Offline                         │
│                                     │
│  📼 Grabaciones                     │
│  └─ Últimas 7 días                 │
└─────────────────────────────────────┘
```

### Dashboard Admin

**URL**: `https://motorcontrol.tudominio.com/admin`

**Vistas**:
```
┌─────────────────────────────────────┐
│  Admin Dashboard - Todos Clientes   │
├─────────────────────────────────────┤
│  📊 Resumen                         │
│  - 15 Clientes activos              │
│  - 45 Cámaras online                │
│  - 3 Alertas                        │
│                                     │
│  👥 Clientes                        │
│  ┌───────────────────────────────┐ │
│  │ Cliente 001 - Casa              │ │
│  │ ● Online | 3 cámaras           │ │
│  │ [Ver cámaras] [Editar]         │ │
│  └───────────────────────────────┘ │
│                                     │
│  ┌───────────────────────────────┐ │
│  │ Cliente 002 - Empresa           │ │
│  │ ⚫ Offline | 5 cámaras          │ │
│  │ [Ver cámaras] [Editar]         │ │
│  └───────────────────────────────┘ │
│                                     │
│  🎥 Todas las Cámaras              │
│  📈 Estadísticas                   │
│  ⚙️  Configuración                 │
└─────────────────────────────────────┘
```

---

## 🔄 Flujo Completo de Acceso

### Usuario Final (Cliente)

```
1. Cliente abre: https://motorcontrol.tudominio.com
   ↓
2. Login con email/password
   ↓
3. Backend valida credenciales
   ↓
4. Genera JWT con { user_id, client_id, role: 'user' }
   ↓
5. Frontend recibe token
   ↓
6. GET /api/cameras (con token)
   ↓
7. Backend filtra: WHERE client_id = token.client_id
   ↓
8. Muestra SOLO cámaras de ese cliente
   ↓
9. Usuario hace click en "Ver stream"
   ↓
10. GET /api/stream/:cameraId/hls
    ↓
11. Backend valida:
    - Token válido ✓
    - Cámara pertenece a ese cliente ✓
    ↓
12. Proxy stream desde edge gateway
    ↓
13. Usuario ve video en navegador
```

### Administrador

```
1. Admin abre: https://motorcontrol.tudominio.com/admin
   ↓
2. Login admin
   ↓
3. JWT con { role: 'admin' }
   ↓
4. GET /api/admin/clients
   ↓
5. Muestra TODOS los clientes
   ↓
6. Admin selecciona cliente
   ↓
7. GET /api/admin/cameras/client/:clientId
   ↓
8. Muestra cámaras de ese cliente
   ↓
9. Admin hace click en cámara
   ↓
10. GET /api/admin/stream/:clientId/:cameraId/hls
    ↓
11. Proxy stream (sin filtros, es admin)
    ↓
12. Admin ve cualquier cámara
```

---

## 📱 App Android - Detalles

### Stack Tecnológico Recomendado

```kotlin
// build.gradle
dependencies {
    // Networking
    implementation 'com.squareup.retrofit2:retrofit:2.9.0'
    implementation 'com.squareup.retrofit2:converter-gson:2.9.0'

    // Video Player
    implementation 'com.google.android.exoplayer:exoplayer:2.19.1'

    // Authentication
    implementation 'com.auth0.android:jwtdecode:2.0.1'

    // Storage (para token)
    implementation 'androidx.security:security-crypto:1.1.0-alpha06'

    // Push Notifications
    implementation 'com.google.firebase:firebase-messaging:23.4.0'
}
```

### Pantallas Principales

1. **Login Screen**
2. **Camera List Screen** (Grid o Lista)
3. **Live Stream Screen** (ExoPlayer)
4. **Recordings Screen** (Opcional)
5. **Settings Screen**

### Ejemplo: API Service

```kotlin
// ApiService.kt
interface ApiService {
    @POST("api/mobile/auth/login")
    suspend fun login(@Body credentials: LoginRequest): LoginResponse

    @GET("api/mobile/cameras")
    suspend fun getCameras(@Header("Authorization") token: String): CamerasResponse

    @GET("api/mobile/stream/{cameraId}/hls")
    suspend fun getStreamUrl(
        @Path("cameraId") cameraId: Int,
        @Header("Authorization") token: String
    ): String
}

// Repository
class CameraRepository(private val api: ApiService) {
    suspend fun getCameras(token: String): List<Camera> {
        val response = api.getCameras("Bearer $token")
        return response.cameras
    }

    suspend fun getStreamUrl(cameraId: Int, token: String): String {
        return api.getStreamUrl(cameraId, "Bearer $token")
    }
}

// ViewModel
class CameraViewModel(private val repository: CameraRepository) : ViewModel() {
    private val _cameras = MutableLiveData<List<Camera>>()
    val cameras: LiveData<List<Camera>> = _cameras

    fun loadCameras() {
        viewModelScope.launch {
            val token = getStoredToken()
            _cameras.value = repository.getCameras(token)
        }
    }
}
```

---

## 🔒 Seguridad - Checklist

### Backend
- ✅ JWT con expiración (24h)
- ✅ HTTPS obligatorio en producción
- ✅ Rate limiting en endpoints de login
- ✅ Validación de permisos en CADA request
- ✅ Passwords con bcrypt (10+ rounds)
- ✅ Logs de acceso

### Frontend/App
- ✅ Token almacenado seguro (EncryptedSharedPreferences)
- ✅ No guardar passwords en claro
- ✅ Timeout de sesión
- ✅ Validación de certificado SSL

### Network
- ✅ HTTPS para API
- ✅ TLS para MQTT (si expuesto)
- ✅ VPN/Tailscale para edge gateways
- ✅ Firewall en servidor

---

## 📊 Resumen de URLs

| Usuario | Acceso | URL |
|---------|--------|-----|
| **Cliente Final** | Navegador Web | `https://motorcontrol.tudominio.com/dashboard` |
| **Cliente Final** | App Android | App nativa (consume API REST) |
| **Administrador** | Dashboard | `https://motorcontrol.tudominio.com/admin` |
| **Edge Gateway** | MQTT | `mqtt://motorcontrol.tudominio.com:1883` o VPN |

---

## 🎯 Siguiente Paso

Para implementar esto necesitas:

1. **Modificar MotorControlAPI** para agregar:
   - Modelos: `Client`, `Camera` actualizados
   - Endpoints para usuarios: `/api/cameras`, `/api/stream/:id/hls`
   - Endpoints para admin: `/api/admin/clients`, `/api/admin/cameras/...`
   - Stream proxy middleware

2. **Frontend Web** (Dashboard):
   - React/Vue/Angular
   - Login page
   - Dashboard de usuario
   - Dashboard de admin
   - Video player (HLS.js o WebRTC)

3. **App Android**:
   - Kotlin con Jetpack Compose
   - Retrofit para API
   - ExoPlayer para video
   - Firebase Cloud Messaging para notificaciones

¿Quieres que te ayude a implementar alguna de estas partes?
