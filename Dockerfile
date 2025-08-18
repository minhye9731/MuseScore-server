FROM ubuntu:22.04

# 환경 변수 설정
ENV DEBIAN_FRONTEND=noninteractive
ENV NODE_MAJOR=18

# 시스템 업데이트 및 필수 패키지 설치
RUN apt-get update && apt-get install -y \
    curl \
    wget \
    xvfb \
    xauth \
    dbus-x11 \
    software-properties-common \
    && rm -rf /var/lib/apt/lists/*

# MuseScore 설치 (여러 방법 시도)
RUN apt-get update && apt-get install -y \
    musescore3 \
    && rm -rf /var/lib/apt/lists/*

# 대안으로 snap으로도 설치 시도 (주석 처리됨 - 필요시 활성화)
# RUN apt-get update && apt-get install -y snapd \
#     && snap install musescore

# Node.js 설치
RUN curl -fsSL https://deb.nodesource.com/setup_${NODE_MAJOR}.x | bash - \
    && apt-get install -y nodejs

# 작업 디렉토리 설정
WORKDIR /app

# 패키지 파일 복사 및 의존성 설치
COPY package*.json ./
RUN npm install

# 소스 코드 복사
COPY . .

# uploads 디렉토리 생성
RUN mkdir -p uploads

# 권한 설정
RUN chmod +x /app/uploads

# MuseScore 실행 파일 확인 및 심볼릭 링크 생성
RUN which musescore3 || which musescore || echo "MuseScore not found" \
    && if [ -f /usr/bin/musescore3 ]; then ln -sf /usr/bin/musescore3 /usr/local/bin/mscore; fi \
    && if [ -f /usr/bin/musescore ]; then ln -sf /usr/bin/musescore /usr/local/bin/mscore; fi

# 포트 노출
EXPOSE 3000

# 가상 디스플레이 및 서버 시작 스크립트 생성
RUN echo '#!/bin/bash\n\
echo "🖥️  가상 디스플레이 시작..."\n\
Xvfb :99 -screen 0 1024x768x24 -ac &\n\
export DISPLAY=:99\n\
sleep 2\n\
echo "🔍 MuseScore 설치 확인..."\n\
which musescore3 && echo "✅ musescore3 발견: $(which musescore3)"\n\
which musescore && echo "✅ musescore 발견: $(which musescore)"\n\
which mscore && echo "✅ mscore 발견: $(which mscore)"\n\
ls -la /usr/bin/*score* 2>/dev/null || echo "⚠️  score 관련 실행파일 없음"\n\
echo "🚀 Node.js 서버 시작..."\n\
exec "$@"' > /app/start.sh \
    && chmod +x /app/start.sh

# 서버 시작
CMD ["/app/start.sh", "node", "app.js"]
