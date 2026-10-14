FROM nousresearch/hermes-agent@sha256:444b42594e7f467425872fc35e077a227d377f0fe0726bc818706d62175fad8b

ENV HERMES_HOME=/opt/data \
    HERMES_GATEWAY_NO_SUPERVISE=1 \
    HERMES_DASHBOARD=0 \
    PYTHONUNBUFFERED=1 \
    API_SERVER_HOST=0.0.0.0 \
    API_SERVER_MODEL_NAME=jarvis

COPY cloud /opt/jarvis
WORKDIR /opt/data
EXPOSE 10000
CMD ["python3", "/opt/jarvis/bootstrap.py"]
