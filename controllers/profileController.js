import * as profiles from "../services/profileService.js";
import { profileView } from "../utils/serializers.js";

const send = async (res, { profile, user, counts }) =>
  res.status(200).json(await profileView(profile, user, counts));

export const createOrUpdateProfile = async (req, res) => {
  await send(
    res,
    await profiles.saveProfile(req.user, req.valid.body, req.file)
  );
};

export const getMyProfile = async (req, res) => {
  await send(res, await profiles.getProfile(req.user._id));
};

export const getUserProfileById = async (req, res) => {
  await send(res, await profiles.getProfile(req.valid.params.userId));
};
