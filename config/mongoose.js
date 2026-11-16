import mongoose from "mongoose";
import { getAutoIndex } from "./env.js";

// Query filters built from client input are sanitised by default. Queries that
// legitimately use operators wrap them in mongoose.trusted().
mongoose.set("sanitizeFilter", true);

// See MONGO_AUTO_INDEX in .env.example.
mongoose.set("autoIndex", getAutoIndex());
