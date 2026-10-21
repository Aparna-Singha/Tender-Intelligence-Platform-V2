FROM debian:trixie-slim

RUN apt-get update \
    && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
      ca-certificates clamav-daemon clamav-freshclam netcat-openbsd tini \
    && rm -rf /var/lib/apt/lists/*

COPY infrastructure/docker/clamav/clamd.conf /etc/clamav/clamd.conf
COPY infrastructure/docker/clamav/freshclam.conf /etc/clamav/freshclam.conf
COPY infrastructure/docker/clamav/start.sh /usr/local/bin/start-clamav

RUN chmod 755 /usr/local/bin/start-clamav

VOLUME ["/var/lib/clamav"]
EXPOSE 3310
ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/start-clamav"]
