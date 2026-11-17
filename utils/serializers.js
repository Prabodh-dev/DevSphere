import { getSignedMediaUrl } from "./s3Utils.js";
import { previewOf } from "./chatPreview.js";

// Only what other users may see about an account.
export const publicUserView = async (user) => {
  if (!user) return user;
  return {
    _id: user._id,
    username: user.username,
    avatar: await getSignedMediaUrl(user.avatarKey),
  };
};

// A profile as shown to clients. The username, avatar and tags belong to the
// user record; the profile holds the bio and links.
export const profileView = async (profile, user, counts) => {
  const { _id, bio, github, linkedin, website, createdAt, updatedAt } =
    profile.toObject();
  return {
    _id,
    user: { _id: user._id, username: user.username },
    avatar: await getSignedMediaUrl(user.avatarKey),
    tags: user.tags ?? [],
    bio,
    github,
    linkedin,
    website,
    ...counts,
    createdAt,
    updatedAt,
  };
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

// Members are shown with their public fields only.
export const chatView = async (chat) => {
  const plain = chat.toObject();
  plain.members = await Promise.all(
    chat.members.map((member) =>
      member.username !== undefined ? publicUserView(member) : member
    )
  );

  // Only a populated message is shown; anything else means "no preview".
  const latest = chat.latestMessage;
  plain.latestMessage =
    latest && latest.createdAt
      ? {
          sender: latest.sender?.username
            ? { _id: latest.sender._id, username: latest.sender.username }
            : null,
          preview: previewOf(latest),
          createdAt: latest.createdAt,
        }
      : null;
  return plain;
};

export const notificationView = async (notification) => {
  const plain = notification.toObject();
  if (plain.fromUser && plain.fromUser.username !== undefined) {
    plain.fromUser = await publicUserView(plain.fromUser);
  }
  return plain;
};
