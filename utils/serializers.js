import { getSignedMediaUrl } from "./s3Utils.js";

// Only what other users may see about an account.
export const publicUserView = async (user) => {
  if (!user) return user;
  return {
    _id: user._id,
    username: user.username,
    avatar: await getSignedMediaUrl(user.avatarKey),
  };
};

export const profileView = async (profile) => {
  const { avatarKey, ...rest } = profile.toObject();
  return { ...rest, avatar: await getSignedMediaUrl(avatarKey) };
};

// Populated `user` fields must have been selected with "username avatarKey".
export const statusView = async (status) => {
  const { mediaKey, user, ...rest } = status.toObject();
  const view = { ...rest };
  if (user && typeof user === "object" && user.username !== undefined) {
    view.user = await publicUserView(user);
  } else {
    view.user = user;
  }
  if (mediaKey) view.content = await getSignedMediaUrl(mediaKey);
  return view;
};
