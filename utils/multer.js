// utils/multer.js
import multer from "multer";

const storage = multer.memoryStorage(); // buffer-based
const upload = multer({ storage });

export default upload;
