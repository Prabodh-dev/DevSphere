# DevSphere (Backend)

DevSphere is a social platform for developers to connect, chat and share code.
This repository contains the backend: a REST API and a Socket.IO server built
with Node.js, Express and MongoDB.

## Features

- Registration and login with JWT bearer tokens
- Developer profiles (bio, links, tags, avatar upload to S3)
- Follow / unfollow, tags and tag search
- One-to-one and group chat, with text and code messages
- Real-time delivery, typing indicators and online presence over Socket.IO
- 24-hour status posts (text, image, video)
- Server-side syntax highlighting for code snippets
- Shared live code document per chat
- Notifications, content reports and basic admin endpoints

## Tech stack

- Node.js 20+ (ES modules), Express 5
- MongoDB with Mongoose
- Socket.IO
- Redis (optional, used for online presence)
- AWS S3 for uploaded media
- pnpm, Vitest, ESLint and Prettier

## Getting started

Requirements: Node.js 20 or newer, pnpm (via Corepack or a global install) and a MongoDB instance.

```bash
corepack enable
pnpm install
cp .env.example .env   # then fill in the values
pnpm dev               # or: pnpm start
```

The server listens on `PORT` (default `5000`). `GET /healthz` reports whether
the process is up and connected to the database.

## Environment variables

Copy `.env.example` to `.env` and set:

| Variable         | Required    | Purpose                                                 |
| ---------------- | ----------- | ------------------------------------------------------- |
| `MONGO_URI`      | yes         | MongoDB connection string                               |
| `JWT_SECRET`     | yes         | Secret used to sign tokens                              |
| `PORT`           | no          | HTTP port, defaults to `5000`                           |
| `REDIS_URL`      | no          | Redis URL for online presence; the app works without it |
| `AWS_ACCESS_KEY` | for uploads | AWS access key id                                       |
| `AWS_SECRET_KEY` | for uploads | AWS secret access key                                   |
| `AWS_REGION`     | for uploads | AWS region of the bucket                                |
| `AVATAR_BUCKET`  | for uploads | S3 bucket for avatars and status media                  |

The server exits at startup if `MONGO_URI` or `JWT_SECRET` is missing, or if it
cannot connect to MongoDB.

## Scripts

| Command             | What it does                  |
| ------------------- | ----------------------------- |
| `pnpm dev`          | Start with automatic restarts |
| `pnpm start`        | Start the server              |
| `pnpm lint`         | Run ESLint                    |
| `pnpm format`       | Format the code with Prettier |
| `pnpm format:check` | Check formatting              |
| `pnpm test`         | Run the test suite            |

## Testing

The tests are integration tests and need a real MongoDB and Redis. Point them
at throwaway instances:

```bash
export TEST_MONGO_URI=mongodb://127.0.0.1:27017
export REDIS_URL=redis://127.0.0.1:6379
pnpm test
```

The tests use a separate `devsphere_test` database and drop it when finished.
Never point `TEST_MONGO_URI` at a database you care about.

## Docker

```bash
cp .env.example .env   # set JWT_SECRET at least
docker compose up --build
```

Compose starts the app together with MongoDB and Redis. The app overrides
`MONGO_URI` and `REDIS_URL` to point at those containers, and MongoDB is not
published to the host.

## Deployment

Configuration is done entirely through environment variables (see above). Any
host that can run the Docker image or `pnpm start` with those variables set
will work.

## Project structure

```
.
├── app.js            Express app and route wiring
├── server.js         Startup, shutdown, database connection
├── socket.js         Socket.IO server
├── config/           Environment and Redis setup
├── controllers/
├── middlewares/
├── models/
├── routes/
├── utils/
└── tests/
```

## Contributing

Pull requests are welcome. For larger changes, please open an issue first.
Run `pnpm lint` and `pnpm test` before submitting.

## Author

Prabodh Raj U R
