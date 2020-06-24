FROM node:14-alpine

RUN mkdir /app
WORKDIR /app

COPY . .

ADD https://github.com/Yelp/dumb-init/releases/download/v1.2.2/dumb-init_1.2.2_amd64 /usr/local/bin/dumb-init

RUN chmod +x /usr/local/bin/dumb-init && \
	npm install --production

CMD ["dumb-init", "npm", "start"]