FROM python:3.12-slim AS whisper-build

ARG WHISPER_CPP_REPO=https://github.com/ggml-org/whisper.cpp.git
ARG WHISPER_CPP_REF=v1.7.6

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    build-essential \
    ca-certificates \
    cmake \
    git \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /opt
RUN git clone --depth 1 --branch "${WHISPER_CPP_REF}" "${WHISPER_CPP_REPO}" whisper.cpp \
  && cmake -S /opt/whisper.cpp -B /opt/whisper.cpp/build \
    -DCMAKE_BUILD_TYPE=Release \
    -DGGML_NATIVE=OFF \
    -DWHISPER_BUILD_EXAMPLES=ON \
    -DWHISPER_BUILD_TESTS=OFF \
  && cmake --build /opt/whisper.cpp/build --config Release -j "$(nproc)"

FROM python:3.12-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    bash \
    ca-certificates \
    curl \
    ffmpeg \
  && rm -rf /var/lib/apt/lists/*

COPY --from=whisper-build /opt/whisper.cpp /opt/whisper.cpp
RUN if [ -x /opt/whisper.cpp/build/bin/whisper-cli ]; then \
      ln -s /opt/whisper.cpp/build/bin/whisper-cli /usr/local/bin/whisper-cli; \
    elif [ -x /opt/whisper.cpp/build/bin/main ]; then \
      ln -s /opt/whisper.cpp/build/bin/main /usr/local/bin/whisper-cli; \
    else \
      echo "whisper.cpp CLI binary was not built" >&2; exit 1; \
    fi

WORKDIR /app
COPY server ./server
COPY client ./client
COPY config ./config

ENV ASR_BACKEND=http_asr \
  ASR_BASE_URL=http://10.8.0.2:9001 \
  CHANNEL_ADMIN=left \
  CHANNEL_CLIENT=right \
  DASHBOARD_BIND_HOST=0.0.0.0 \
  DASHBOARD_HOST=127.0.0.1 \
  DASHBOARD_PORT=8090 \
  DELETE_AUDIO_AFTER=true \
  POLL_INTERVAL_SECONDS=10 \
  STATE_DB_PATH=/data/transcription-worker.sqlite3 \
  TRANSCRIPTION_AI_POSTPROCESSING_ENABLED=false \
  TRANSCRIPTION_LLM_BASE_URL=http://10.8.0.2:11434 \
  TRANSCRIPTION_LLM_FALLBACK_ENABLED=true \
  TRANSCRIPTION_LLM_MODEL=qwen2.5:7b \
  TRANSCRIPTION_LLM_NUM_CTX=4096 \
  TRANSCRIPTION_LLM_RETRY_COUNT=1 \
  TRANSCRIPTION_LLM_TIMEOUT_SECONDS=90 \
  WHISPER_CPP_BINARY=/usr/local/bin/whisper-cli \
  WHISPER_CPP_DIR=/opt/whisper.cpp \
  WHISPER_LANGUAGE=ru \
  WHISPER_MODEL=small \
  WHISPER_MODEL_CACHE_DIR=/models

EXPOSE 8090

VOLUME ["/models", "/data"]

CMD ["python", "-m", "server.app"]
