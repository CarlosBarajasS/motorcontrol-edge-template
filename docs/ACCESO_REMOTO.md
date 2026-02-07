# Configuración de Acceso Remoto para Streaming de Cámaras

## 🌐 Opciones de Túnel para Acceso desde Cualquier Lugar

### Opción 1: Cloudflare Tunnel (Recomendado - GRATIS) ✅

**Ventajas**:
- ✅ Completamente GRATIS
- ✅ HTTPS automático (SSL)
- ✅ No requiere IP pública
- ✅ No requiere abrir puertos en el router
- ✅ Protección DDoS incluida
- ✅ Muy seguro

**Instalación**:

1. **Instalar Cloudflared**:
```bash
# Windows
# Descargar desde: https://github.com/cloudflare/cloudflared/releases
# O usar winget:
winget install --id Cloudflare.cloudflared
```

2. **Autenticar con Cloudflare**:
```bash
cloudflared tunnel login
```

3. **Crear Túnel**:
```bash
cloudflared tunnel create camara-streaming
```

4. **Configurar el Túnel** - Crear archivo `config.yml`:
```yaml
tunnel: <TUNNEL-ID>
credentials-file: C:\Users\carlo\.cloudflared\<TUNNEL-ID>.json

ingress:
  # HLS Stream (para navegador web)
  - hostname: camara.tudominio.com
    service: http://localhost:8888

  # API de MediaMTX
  - hostname: api-camara.tudominio.com
    service: http://localhost:9997

  # WebRTC (para baja latencia)
  - hostname: webrtc-camara.tudominio.com
    service: http://localhost:8889

  # Catch-all rule
  - service: http_status:404
```

5. **Ejecutar el Túnel**:
```bash
cloudflared tunnel run camara-streaming
```

**Acceso desde Cliente**:
- Web: `https://camara.tudominio.com/cam-principal`
- API: `https://api-camara.tudominio.com`

---

### Opción 2: Ngrok (Fácil - Gratis/Paid)

**Ventajas**:
- ✅ Muy fácil de configurar
- ✅ No requiere dominio propio (en plan free)
- ⚠️ Límite de 40 conexiones/minuto (free tier)
- ⚠️ URL aleatoria en plan free

**Instalación**:

1. **Descargar Ngrok**: https://ngrok.com/download
2. **Registrarse y obtener authtoken**: https://dashboard.ngrok.com/get-started/your-authtoken

```bash
# Autenticar
ngrok config add-authtoken <TU-TOKEN>

# Túnel para HLS
ngrok http 8888 --domain tu-dominio-reservado.ngrok-free.app

# Túnel para WebRTC (en otra terminal)
ngrok http 8889
```

**Acceso**:
- URL pública: `https://tu-dominio.ngrok-free.app/cam-principal`

---

### Opción 3: Tailscale VPN (Para Equipos Distribuidos)

**Ventajas**:
- ✅ Red privada virtual (VPN)
- ✅ Muy seguro
- ✅ Hasta 100 dispositivos gratis
- ⚠️ Requiere cliente en cada dispositivo

**Instalación**:

1. **Instalar Tailscale**: https://tailscale.com/download/windows
2. **Iniciar sesión y conectar**
3. **Tu servidor tendrá una IP privada** (ej: 100.x.x.x)

**Acceso desde Cliente**:
- Cliente debe tener Tailscale instalado
- Acceder a: `http://100.x.x.x:8888/cam-principal`

---

### Opción 4: Port Forwarding (Tradicional - Requiere IP Pública)

**Ventajas**:
- ✅ Sin intermediarios
- ⚠️ Requiere IP pública estática o DDNS
- ⚠️ Requiere configurar router
- ⚠️ Menos seguro (expone puertos)

**Configuración**:

1. **En tu Router**, abre estos puertos:
   - Puerto 8888 → 192.168.3.x:8888 (HLS)
   - Puerto 8889 → 192.168.3.x:8889 (WebRTC)
   - Puerto 9997 → 192.168.3.x:9997 (API)

2. **Obtener tu IP pública**:
   - Ve a: https://whatismyip.com

3. **Configurar DDNS** (si tu IP cambia):
   - Servicios recomendados: No-IP, DuckDNS, Dynu

**Acceso desde Cliente**:
- Web: `http://TU-IP-PUBLICA:8888/cam-principal`

**⚠️ Recomendación de Seguridad**:
Si usas esta opción, configura:
- Firewall para limitar acceso
- Autenticación en MediaMTX
- Certificado SSL con Let's Encrypt

---

## 🔒 Seguridad Recomendada

### Habilitar Autenticación en MediaMTX

Editar `mediamtx.yml`:

```yaml
# Agregar autenticación global
authMethods: [basic]
authBasicUser: usuario
authBasicPass: contraseña_segura

# O por path específico
paths:
  cam-principal:
    source: rtsp://admin:PASSWORD@192.168.3.2:554/Streaming/Channels/101
    readUser: cliente
    readPass: pass_cliente
```

---

## 📊 Comparación de Opciones

| Opción | Costo | Dificultad | Seguridad | Velocidad | Recomendado |
|--------|-------|------------|-----------|-----------|-------------|
| **Cloudflare Tunnel** | Gratis | Media | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ✅ SÍ |
| **Ngrok** | Gratis/Paid | Fácil | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | Para testing |
| **Tailscale** | Gratis | Fácil | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | Para privado |
| **Port Forward** | Gratis | Difícil | ⭐⭐ | ⭐⭐⭐⭐⭐ | Solo con cuidado |

---

## 🎯 Recomendación Final

**Para tu caso de uso** (cliente accediendo desde cualquier lugar):

1. **Cloudflare Tunnel** - Ideal para producción, gratis y seguro
2. **Ngrok** - Rápido para pruebas y demos
3. **Tailscale** - Si solo equipos autorizados deben acceder

