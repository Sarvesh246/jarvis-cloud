FROM nousresearch/hermes-agent@sha256:444b42594e7f467425872fc35e077a227d377f0fe0726bc818706d62175fad8b

RUN apt-get update && apt-get install -y --no-install-recommends libseccomp2 && rm -rf /var/lib/apt/lists/*

ENV HERMES_HOME=/opt/data \
    HERMES_GATEWAY_NO_SUPERVISE=1 \
    HERMES_DASHBOARD=0 \
    PYTHONUNBUFFERED=1 \
    MALLOC_ARENA_MAX=2 \
    VAELO_VERIFIER_PYTHON=/opt/jarvis/verification-env/bin/python \
    API_SERVER_HOST=0.0.0.0 \
    API_SERVER_MODEL_NAME=jarvis

COPY cloud /opt/jarvis
RUN python3 -c "from pathlib import Path; from pm import build_requirements_environment; build_requirements_environment(Path('/opt/jarvis/requirements-verification.txt').read_text().splitlines(), out=Path('/opt/jarvis/verification-env'), explicit=True)" \
    && /opt/jarvis/verification-env/bin/python -I -c "import quickjs; assert quickjs.Context().eval('17 * 23') == 391"
COPY web/shared/context-policy.json /opt/jarvis/context-policy.json
RUN python3 /opt/jarvis/runtime_contract.py /opt/hermes/gateway/platforms/api_server.py
WORKDIR /opt/data
EXPOSE 10000
CMD ["python3", "/opt/jarvis/bootstrap.py"]
