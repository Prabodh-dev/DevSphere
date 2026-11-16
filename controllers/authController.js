import mongoose from "mongoose";
import User from "../models/User.js";
import bcrypt from "bcrypt";
import { signAccessToken } from "../utils/tokens.js";
import { startSession } from "../utils/sessions.js";
import { setRefreshCookie } from "../utils/cookies.js";
import { getAccessTokenTtlSeconds } from "../config/env.js";
import { conflict, forbidden, unauthorized } from "../utils/httpError.js";

// Compared against when the email is unknown so both failures take similar time.
const DUMMY_HASH = bcrypt.hashSync("placeholder-password", 10);

// Starts a session: sets the refresh cookie and returns the access token.
async function signIn(req, res, user, status) {
  const { familyId, refreshToken } = await startSession(user._id, req);
  setRefreshCookie(res, refreshToken);

  res.status(status).json({
    _id: user._id,
    username: user.username,
    email: user.email,
    token: signAccessToken(user._id.toString(), familyId),
    expiresIn: getAccessTokenTtlSeconds(),
  });
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

  await signIn(req, res, user, 201);
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

  await signIn(req, res, user, 200);
};
