# Configurar MQTT con TLS/SSL

## Por qué usar TLS

Cuando el broker MQTT está expuesto a Internet:
- ✅ Encripta las comunicaciones
- ✅ Previene man-in-the-middle attacks
- ✅ Autenticación de clientes con certificados

---

## Paso 1: Generar Certificados

### Opción A: Let's Encrypt (Si tienes dominio)

```bash
# Instalar certbot
sudo apt install certbot

# Generar certificado
sudo certbot certonly --standalone -d motorcontrol.tudominio.com

# Certificados quedan en:
# /etc/letsencrypt/live/motorcontrol.tudominio.com/
```

### Opción B: Auto-firmados (Para testing)

```bash
cd /home/pi/MotorControlAPI/mosquitto/certs

# CA (Certificate Authority)
openssl genrsa -out ca.key 2048
openssl req -new -x509 -days 365 -key ca.key -out ca.crt

# Servidor
openssl genrsa -out server.key 2048
openssl req -new -key server.key -out server.csr
openssl x509 -req -in server.csr -CA ca.crt -CAkey ca.key -CAcreateserial -out server.crt -days 365

# Cliente (opcional, para autenticación mutua)
openssl genrsa -out client.key 2048
openssl req -new -key client.key -out client.csr
openssl x509 -req -in client.csr -CA ca.crt -CAkey ca.key -CAcreateserial -out client.crt -days 365
```

---

## Paso 2: Configurar Mosquitto

Editar `/home/pi/MotorControlAPI/mosquitto/config/mosquitto.conf`:

```conf
# Puerto sin TLS (solo local)
listener 1883 127.0.0.1
allow_anonymous false
password_file /mosquitto/config/passwd

# Puerto con TLS (público)
listener 8883 0.0.0.0
allow_anonymous false
password_file /mosquitto/config/passwd

# Certificados
cafile /mosquitto/certs/ca.crt
certfile /mosquitto/certs/server.crt
keyfile /mosquitto/certs/server.key

# Requerir certificado de cliente (opcional)
# require_certificate true
# use_identity_as_username true
```

**En docker-compose.yml**, agregar mapeo de puerto:

```yaml
mosquitto:
  ports:
    - "1885:1883"  # Puerto sin TLS (local)
    - "8883:8883"  # Puerto con TLS (público)
  volumes:
    - ./mosquitto/certs:/mosquitto/certs:ro
```

---

## Paso 3: Reiniciar Mosquitto

```bash
cd /home/pi/MotorControlAPI
docker-compose restart mosquitto

# Verificar que escucha en ambos puertos
docker exec mosquitto netstat -tuln | grep 1883
docker exec mosquitto netstat -tuln | grep 8883
```

---

## Paso 4: Configurar Edge Gateway con TLS

### Copiar Certificado CA al Edge

```bash
# En el servidor
scp /home/pi/MotorControlAPI/mosquitto/certs/ca.crt pi@edge-gateway:/home/pi/

# En el edge
sudo mkdir -p /etc/mosquitto/certs
sudo mv /home/pi/ca.crt /etc/mosquitto/certs/
```

### Actualizar Dockerfile del Edge

```dockerfile
# edge-agent/Dockerfile
FROM node:20-alpine

WORKDIR /app

# Copiar certificados
COPY certs/ca.crt /etc/mosquitto/certs/ca.crt

COPY package*.json ./
RUN npm install --production

COPY . .

CMD ["node", "server.js"]
```

### Actualizar MqttClientService.js

```javascript
// edge-agent/services/MqttClientService.js
const fs = require('fs');
const mqtt = require('mqtt');

// ...

async connect() {
  const { host, port, username, password, clientId, useTLS } = this.config;

  const protocol = useTLS ? 'mqtts' : 'mqtt';
  const brokerUrl = `${protocol}://${host}:${port}`;

  const options = {
    clientId,
    clean: true,
    connectTimeout: 10000,
    reconnectPeriod: 5000,
    keepalive: 60,
  };

  if (username && password) {
    options.username = username;
    options.password = password;
  }

  // Si usa TLS, agregar certificados
  if (useTLS) {
    options.ca = fs.readFileSync('/etc/mosquitto/certs/ca.crt');
    // Opcional: certificado de cliente
    // options.cert = fs.readFileSync('/etc/mosquitto/certs/client.crt');
    // options.key = fs.readFileSync('/etc/mosquitto/certs/client.key');
  }

  this.client = mqtt.connect(brokerUrl, options);
  // ...
}
```

### Actualizar .env del Edge

```env
MQTT_HOST=motorcontrol.tudominio.com
MQTT_PORT=8883
MQTT_USE_TLS=true
MQTT_USERNAME=client-001
MQTT_PASSWORD=secure_password
```

---

## Paso 5: Probar Conexión

```bash
# Desde el edge, probar conexión TLS
mosquitto_sub -h motorcontrol.tudominio.com -p 8883 \
  --cafile /etc/mosquitto/certs/ca.crt \
  -u client-001 -P password \
  -t 'test' -v
```

---

## Comparación: TLS vs No-TLS

| Aspecto | Sin TLS | Con TLS |
|---------|---------|---------|
| **Seguridad** | ❌ Datos en texto plano | ✅ Encriptado |
| **Autenticación** | ⚠️ Solo usuario/password | ✅ Certificados |
| **Complejidad** | ✅ Simple | ⚠️ Requiere certs |
| **Performance** | ✅ Rápido | ⚠️ ~5% overhead |
| **Uso recomendado** | Red local/VPN | Internet público |

---

## Recomendación

1. **Red Local / VPN (Tailscale)**: No-TLS (puerto 1883)
   - Más simple
   - VPN ya provee encriptación

2. **Internet Público**: TLS (puerto 8883)
   - Necesario para seguridad
   - Usar Let's Encrypt si tienes dominio

---

## Troubleshooting

### Error: "certificate verify failed"

```bash
# Verificar que el CA está correcto
openssl verify -CAfile ca.crt server.crt

# Verificar hostname en certificado
openssl x509 -in server.crt -text -noout | grep DNS
```

### Error: "Connection refused"

```bash
# Verificar que Mosquitto escucha en 8883
docker exec mosquitto netstat -tuln | grep 8883

# Ver logs de Mosquitto
docker logs mosquitto
```

### Edge no se conecta con TLS

```bash
# Probar manualmente
mosquitto_pub -h motorcontrol.tudominio.com -p 8883 \
  --cafile ca.crt \
  -u client-001 -P password \
  -t 'test' -m 'hello' -d
```

