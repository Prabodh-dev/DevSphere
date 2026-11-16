import dotenv from "dotenv";
dotenv.config();

import mongoose from "mongoose";
import http from "http";
import app from "./app.js";
import { setupSocketIO } from "./socket.js";

// Create HTTP server and init socket
const server = http.createServer(app);

try {
  setupSocketIO(server);
  console.log(" Socket.IO initialized");
} catch (err) {
  console.error(" Socket.IO setup failed", err);
}

mongoose
  .connect(process.env.MONGO_URI)
  .then(() => {
    console.log(" MongoDB Connected");
    console.log(" Spanning in to DevSphere server");
    const PORT = process.env.PORT || 5000;
    server.listen(PORT, () => console.log(` Server running on port ${PORT}`));
  })
  .catch((err) => console.error(" MongoDB Connection Error:", err));
