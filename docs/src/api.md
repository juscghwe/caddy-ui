# API reference

Management endpoints require [authentication](authentication.md) and verified HTTPS by default. For multi-instance behavior, see [instances](instances.md).

{{#include ../../README.md:api-endpoints}}

Browser EventSource uses the session cookie. Caddy access-log streams accept a
non-secret `instanceId` registry ID in the query because EventSource cannot send
`X-Instance-Id`; unknown IDs are rejected. Application-log streams are global.
Session credentials, setup codes and CSRF tokens never belong in URLs.
