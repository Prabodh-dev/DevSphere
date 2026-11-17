import { createReport as fileReport } from "../services/reportService.js";

export const createReport = async (req, res) => {
  const report = await fileReport(req.user, req.valid.body);
  res.status(201).json(report);
};
