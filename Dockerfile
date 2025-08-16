FROM ubuntu:22.04

# 환경 변수 설정
ENV DEBIAN_FRONTEND=noninteractive
ENV NODE_MAJOR=18

# 필수 패키지 설치
RUN apt-get update && apt-get install -y \
    curl \
    xvfb \
    musescore3 \
    && rm -rf /var/lib/apt/lists/*

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

# 포트 노출
EXPOSE 3000

# MuseScore를 headless 모드로 실행하기 위한 설정
ENV DISPLAY=:99
RUN echo '#!/bin/bash\nXvfb :99 -screen 0 1024x768x24 &\nexec "$@"' > /app/start.sh \
    && chmod +x /app/start.sh

# 서버 시작
CMD ["/app/start.sh", "node", "app.js"]
