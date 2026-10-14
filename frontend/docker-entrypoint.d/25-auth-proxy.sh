#!/bin/sh
set -eu
target="${1:-/etc/nginx/conf.d/00-auth-proxy.conf}"
temporary="$target.tmp"
trap 'rm -f "$temporary"' EXIT
printf 'geo $trusted_edge {\n    default 0;\n' > "$temporary"
for peer in $(printf '%s' "${CADDY_UI_TRUSTED_EDGE_IPS:-}" | tr ',' ' '); do
    case "$peer" in
        *[!0-9a-fA-F:./]*|0.0.0.0/0|::/0) echo 'Invalid trusted edge IP/CIDR' >&2; exit 1 ;;
    esac
    case "$peer" in
        */*)
            mask="${peer##*/}"
            case "$mask" in ''|*[!0-9]*) echo 'Invalid trusted edge mask' >&2; exit 1 ;; esac
            case "$peer" in *:*) maximum=128 ;; *) maximum=32 ;; esac
            if [ "$mask" -lt 1 ] || [ "$mask" -gt "$maximum" ]; then
                echo 'Trusted edge mask must select specific addresses' >&2; exit 1
            fi
            ;;
    esac
    printf '    %s 1;\n' "$peer" >> "$temporary"
done
cat >> "$temporary" <<'NGINX'
}
map "$trusted_edge:$http_x_forwarded_proto" $api_forwarded_proto {
    default $scheme;
    "1:https" https;
}
map $trusted_edge $api_forwarded_for {
    default $remote_addr;
    1 $http_x_forwarded_for;
}
NGINX
mv "$temporary" "$target"
