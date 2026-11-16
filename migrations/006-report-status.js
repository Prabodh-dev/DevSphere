export const description =
  "Give reports a status and resolve repeat open reports from the same user";

export async function run({ db, dryRun }) {
  const reports = db.collection("reports");
  const noStatus = { status: { $exists: false } };

  const missing = await reports.countDocuments(noStatus);
  if (!dryRun && missing > 0) {
    await reports.updateMany(noStatus, { $set: { status: "open" } });
  }

  // Reports without a status count as open. For each user and target only the
  // oldest open report stays open.
  const groups = await reports
    .aggregate([
      { $match: { $or: [{ status: "open" }, noStatus] } },
      { $sort: { createdAt: 1, _id: 1 } },
      {
        $group: {
          _id: { by: "$reportedBy", type: "$targetType", target: "$targetId" },
          ids: { $push: "$_id" },
        },
      },
      { $match: { "ids.1": { $exists: true } } },
    ])
    .toArray();

  const repeats = groups.flatMap((group) => group.ids.slice(1));
  if (!dryRun && repeats.length > 0) {
    await reports.updateMany(
      { _id: { $in: repeats } },
      { $set: { status: "resolved", resolvedAt: new Date() } }
    );
  }

  return { changed: missing + repeats.length };
}
