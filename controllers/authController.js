import User from "../models/User.js";
import bcrypt from "bcrypt";
import generateToken from "../utils/generateToken.js";
import {
  badRequest,
  conflict,
  notFound,
  unauthorized,
} from "../utils/httpError.js";
import { requireString } from "../utils/validate.js";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function readEmail(value) {
  const email = requireString(value, "email", { max: 254 }).toLowerCase();
  if (!EMAIL_PATTERN.test(email)) throw badRequest("email is not valid");
  return email;
}

function publicUser(user) {
  return {
    _id: user._id,
    username: user.username,
    email: user.email,
    token: generateToken(user._id),
  };
}

export const registerUser = async (req, res) => {
  const body = req.body ?? {};
  const username = requireString(body.username, "username", {
    min: 3,
    max: 30,
  });
  const email = readEmail(body.email);
  // bcrypt only uses the first 72 bytes, so cap the length.
  const password = requireString(body.password, "password", {
    min: 8,
    max: 72,
  });

  const emailTaken = await User.exists({ email });
  if (emailTaken) throw conflict("Email already used");

  const usernameTaken = await User.exists({ username });
  if (usernameTaken) throw conflict("Username already taken");

  const hashedPassword = await bcrypt.hash(password, 10);
  const user = await User.create({
    username,
    email,
    password: hashedPassword,
  });

  res.status(201).json(publicUser(user));
};

export const loginUser = async (req, res) => {
  const body = req.body ?? {};
  const email = readEmail(body.email);
  const password = requireString(body.password, "password", { max: 72 });

  // Accounts created before emails were normalised may be stored with their
  // original casing, so accept either form.
  const rawEmail = body.email.trim();
  const user = await User.findOne({ email: { $in: [email, rawEmail] } });
  if (!user) throw notFound("User not found");

  const match = await bcrypt.compare(password, user.password);
  if (!match) throw unauthorized("Invalid credentials");

  res.status(200).json(publicUser(user));
};
