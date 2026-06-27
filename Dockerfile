FROM node:20-bookworm-slim

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates g++ make \
  && rm -rf /var/lib/apt/lists/*

COPY package.json ./
COPY cpp ./cpp
COPY scripts ./scripts
COPY web ./web
COPY app_data ./app_data
COPY data ./data
COPY system ./system
COPY pipisa.json server.js README.md ./

RUN npm run build

ENV HOST=0.0.0.0
ENV PORT=5173

EXPOSE 5173

CMD ["npm", "start"]
