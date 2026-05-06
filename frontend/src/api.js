import axios from "axios";

export async function uploadFile(file) {
  const form = new FormData();
  form.append("file", file);
  const { data } = await axios.post("/upload", form);
  return data; // UploadResponse
}

export async function analyzeFile(fileId) {
  const { data } = await axios.post(`/analyze/${fileId}`);
  return data; // AnalyzeResponse
}

export async function patchRow(fileId, rowId, fields) {
  const { data } = await axios.patch(`/row/${fileId}/${rowId}`, fields);
  return data; // EnrichedGLRow
}

export function exportUrl(fileId, format, includeRaw) {
  return `/export/${fileId}?format=${format}&include_raw=${includeRaw}`;
}
