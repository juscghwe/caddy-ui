# Spanish (Spain): Errors · part 1

**Unreviewed agent-generated proposals. No entry on this page is approved for shipment.**

[Language index](README.md) · [Review instructions](../README.md)

Compare the wording with English, correct it, and only then tick its review box. You may instead send corrections or explicit approvals by number in chat.

### 031 · `errors.backendUnreachable`

**English:** Could not reach backend

**Draft:** No se ha podido conectar con el servidor

- [X] Human-reviewed

### 032 · `errors.languageLoadFailed`

**English:** Could not load that language. Try reloading the page.

**Draft:** No se ha podido cargar ese idioma. Intenta volver a cargar la página.

- [X] Human-reviewed

### 033 · `errors.generic`

**English:** The operation failed. See the application logs for details.

**Draft:** La operación ha fallado. Consulta los registros de la aplicación para obtener más información.

- [X] Human-reviewed

### 034 · `errors.network`

**English:** Cannot reach the server. Check your connection.

**Draft:** No se puede conectar con el servidor. Comprueba tu conexión.

- [X] Human-reviewed

### 035 · `errors.unauthorized`

**English:** Your session has expired. Please sign in again.

**Draft:** Tu sesión ha caducado. Inicia sesión de nuevo.

- [X] Human-reviewed

### 036 · `errors.forbidden`

**English:** You do not have permission to perform this operation.

**Draft:** No tienes permiso para realizar esta operación.

- [X] Human-reviewed

### 037 · `errors.csrfInvalid`

**English:** Your request context expired or changed. Retry the action, or reload and sign in again.

**Draft:** El contexto de tu solicitud ha caducado o ha cambiado. Vuelve a intentar la acción o actualiza la página e inicia sesión de nuevo.

- [X] Human-reviewed

### 038 · `errors.authPersistenceFailed`

**English:** Credentials could not be saved. Check the authentication storage permissions and available disk space before retrying.

**Draft:** No se han podido guardar las credenciales. Comprueba los permisos de almacenamiento de autenticación y el espacio disponible en disco antes de volver a intentarlo.

- [X] Human-reviewed

### 039 · `errors.webhookDestinationBlocked`

**English:** Notifications cannot be sent to loopback or link-local addresses. Use an address the backend reaches over the network, such as a LAN IP or Docker service name.

**Draft:** No se pueden enviar notificaciones a direcciones de bucle invertido ni a direcciones locales de enlace. Usa una dirección a la que el backend pueda acceder por la red, como una dirección IP de LAN o un nombre de servicio de Docker.

- [X] Human-reviewed

### 040 · `errors.notificationSendFailed`

**English:** Could not send the notification. See the application logs for details.

**Draft:** No se ha podido enviar la notificación. Consulta los registros de la aplicación para obtener más información.

- [X] Human-reviewed

### 041 · `errors.logFileMissing`

**English:** The log file was not found.

**Draft:** No se ha encontrado el archivo de registro.

- [X] Human-reviewed

### 042 · `errors.logStreamError`

**English:** Could not stream Caddy logs. See the application logs for details.

**Draft:** No se han podido transmitir los registros de Caddy. Consulta los registros de la aplicación para obtener más información.

- [X] Human-reviewed

### 043 · `errors.rateLimited`

**English:** Too many requests. Please try again later.

**Draft:** Demasiadas solicitudes. Inténtalo de nuevo más tarde.

- [X] Human-reviewed

### 044 · `errors.validationFailed`

**English:** Validation failed. Check the configuration and application logs.

**Draft:** La validación ha fallado. Comprueba la configuración y los registros de la aplicación.

- [X] Human-reviewed

### 045 · `errors.notFound`

**English:** The requested resource was not found.

**Draft:** No se ha encontrado el recurso solicitado.

- [X] Human-reviewed

### 046 · `errors.conflict`

**English:** The operation conflicts with the current configuration.

**Draft:** La operación entra en conflicto con la configuración actual.

- [X] Human-reviewed

### 047 · `errors.upstreamUnavailable`

**English:** The Caddy server is unavailable.

**Draft:** El servidor Caddy no está disponible.

- [X] Human-reviewed

### 048 · `errors.metricsUnavailable`

**English:** Metrics are temporarily unavailable.

**Draft:** Las métricas no están disponibles temporalmente.

- [x] Human-reviewed

### 049 · `errors.validationWarning`

**English:** Validation completed with warnings. See the application logs.

**Draft:** La validación ha finalizado con advertencias. Consulta los registros de la aplicación.

- [x] Human-reviewed

### 050 · `errors.operationWarning`

**English:** The operation completed with warnings. See the application logs.

**Draft:** La operación ha finalizado con advertencias. Consulta los registros de la aplicación.

- [x] Human-reviewed

### 051 · `errors.viewLogs`

**English:** View logs

**Draft:** Ver registros

- [x] Human-reviewed

### 052 · `errors.caddyfileReadFailed`

**English:** Could not read the Caddyfile.

**Draft:** No se ha podido leer el Caddyfile.

- [x] Human-reviewed

### 053 · `errors.caddyfileWriteFailed`

**English:** Could not write the Caddyfile. Nothing was changed.

**Draft:** No se ha podido escribir el Caddyfile. No se ha modificado nada.

- [x] Human-reviewed

### 054 · `errors.caddyfileChangeRejected`

**English:** Caddy rejected the change, so the previous Caddyfile was restored.

**Draft:** Caddy ha rechazado el cambio, por lo que se se restableció el Caddyfile anterior.

- [x] Human-reviewed

### 055 · `errors.caddyfileRollbackFailed`

**English:** Caddy rejected the change and the previous Caddyfile could not be restored. The file on disk does not match what Caddy is running.

**Draft:** Caddy rechazó el cambio y no se pudo restaurar el archivo Caddyfile anterior. El archivo del disco no coincide con el que está ejecutando Caddy.

- [x] Human-reviewed

[Previous](03-pages.md) · [Language index](README.md) · [Next](05-errors-2.md)
