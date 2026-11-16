import mongoose from "mongoose";

// Query filters built from client input are sanitised by default. Queries that
// legitimately use operators wrap them in mongoose.trusted().
mongoose.set("sanitizeFilter", true);
