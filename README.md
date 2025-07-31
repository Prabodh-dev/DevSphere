# 🚀 DevSphere – Developer Social Platform (Backend)

DevSphere is a social platform for developers to connect, collaborate, and share knowledge in real time. Built with a robust backend using **Node.js**, **Express**, **MongoDB**, and **Socket.IO**, it powers features like developer profiles, real-time chats, stories (statuses), code snippet sharing, and live collaborative editing.

---

## 🔧 Tech Stack

- **Backend**: Node.js, Express.js
- **Database**: MongoDB (Mongoose)
- **Authentication**: JWT
- **Real-Time Communication**: Socket.IO
- **Cloud Storage**: AWS S3 (for avatar uploads)
- **Redis**: Online status tracking (Upstash Redis)
- **DevOps**: Docker, Railway for deployment

---

## ⚙️ Features

- 🔐 JWT Auth (Register/Login)
- 👤 Developer Profiles (bio, GitHub, LinkedIn, tags, avatar upload)
- 👥 Follow System
- 💬 Real-Time 1-on-1 and Group Chat
- 🟢 Online Status with Redis
- 📸 Status System (Like WhatsApp Stories)
- 🧠 Share Code Snippets with Syntax Highlighting
- 🧑‍💻 Collaborative Code Editor (Live updates via Socket.IO)
- 🚨 Admin Controls for group management and moderation
- ☁️ Image Upload via AWS S3

---

## 📁 Project Structure

.
├── config/
├── controllers/
├── middleware/
├── models/
├── routes/
├── socket.js
├── server.js
├── Dockerfile
├── docker-compose.yml
└── .env.example

yaml
Copy
Edit

---

## 🧪 API Testing

All APIs are tested using **Postman**.  
JWT Auth is required for protected routes.  
Use `Authorization: Bearer <token>` in headers.

---

## 🐳 Docker Support

You can run the backend using Docker:

```bash
docker-compose up --build
Ensure you’ve set environment variables via .env.

🚀 Deployment
Currently deployed on Railway:
🔗 https://devsphere-production.up.railway.app

🔐 Environment Variables
Copy .env.example → create .env:

makefile
Copy
Edit
PORT=
MONGO_URI=
JWT_SECRET=
AWS_ACCESS_KEY=
AWS_SECRET_KEY=
AWS_REGION=
AVATAR_BUCKET=
REDIS_URL=
🧠 About the Project
DevSphere is designed for developer-to-developer communication, knowledge exchange, and collaboration.
It’s like a mix of Discord, GitHub, and WhatsApp — built for devs.

🤝 Contributing
Pull requests are welcome!
For major changes, open an issue first.

🧑‍💻 Author
Prabodh Raj U R
Backend & DevOps Developer

⭐️ Show your support
If you liked the project, give it a ⭐️ on GitHub!
