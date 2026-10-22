FROM nousresearch/hermes-agent@sha256:444b42594e7f467425872fc35e077a227d377f0fe0726bc818706d62175fad8b

RUN apt-get update && apt-get install -y --no-install-recommends libseccomp2 && rm -rf /var/lib/apt/lists/*

ENV HERMES_HOME=/opt/data \
    HERMES_GATEWAY_NO_SUPERVISE=1 \
    HERMES_DASHBOARD=0 \
    PYTHONUNBUFFERED=1 \
    MALLOC_ARENA_MAX=2 \
    API_SERVER_HOST=0.0.0.0 \
    API_SERVER_MODEL_NAME=jarvis

COPY cloud /opt/jarvis
RUN python3 -m pip install --no-cache-dir -r /opt/jarvis/requirements-verification.txt
COPY web/shared/context-policy.json /opt/jarvis/context-policy.json
RUN python3 /opt/jarvis/runtime_contract.py /opt/hermes/gateway/platforms/api_server.py
WORKDIR /opt/data
EXPOSE 10000
CMD ["python3", "/opt/jarvis/bootstrap.py"]
