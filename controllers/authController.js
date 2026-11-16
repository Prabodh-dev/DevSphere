import mongoose from "mongoose";
import User from "../models/User.js";
import bcrypt from "bcrypt";
import generateToken from "../utils/generateToken.js";
import { conflict, forbidden, unauthorized } from "../utils/httpError.js";

// Compared against when the email is unknown so both failures take similar time.
const DUMMY_HASH = bcrypt.hashSync("placeholder-password", 10);

function publicUser(user) {
  return {
    _id: user._id,
    username: user.username,
    email: user.email,
    token: generateToken(user._id),
  };
}

export const registerUser = async (req, res) => {
  const { username, email, password } = req.valid.body;

  if (await User.exists({ email })) throw conflict("Email already used");
  if (await User.exists({ username })) throw conflict("Username already taken");

  const hashedPassword = await bcrypt.hash(password, 10);
  const user = await User.create({
    username,
    email,
    password: hashedPassword,
  });

  res.status(201).json(publicUser(user));
};

export const loginUser = async (req, res) => {
  const { email: rawEmail, password } = req.valid.body;
  const email = rawEmail.toLowerCase();

  // Accounts created before emails were normalised may be stored with their
  // original casing, so accept either form.
  const user = await User.findOne({
    email: mongoose.trusted({ $in: [email, rawEmail] }),
  });

  const match = await bcrypt.compare(password, user?.password ?? DUMMY_HASH);
  if (!user || !match) throw unauthorized("Invalid credentials");

  if (user.isBlocked) throw forbidden("Account is blocked");

  res.status(200).json(publicUser(user));
};
