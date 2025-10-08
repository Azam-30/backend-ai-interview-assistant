// backend/server.js
import dotenv from "dotenv";
import express from "express";
import cors from "cors";
import multer from "multer";
import pdfParse from "pdf-parse-fixed";
import mammoth from "mammoth";
import fs from "fs";
import path from "path";
import { GoogleGenerativeAI } from "@google/generative-ai";

dotenv.config();
console.log("🔑 GEMINI_API_KEY exists:", !!process.env.GEMINI_API_KEY);


const app = express();
app.use(cors());
app.use(express.json());

// 🧠 Initialize Gemini model
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-flash-latest" });

// 📂 Setup upload storage (temporary)
const upload = multer({ dest: "/tmp/" });

// 🧩 Helper functions
function extractJSON(text) {
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
    return match ? JSON.parse(match[0]) : null;
  }
}
const extractEmail = (t) =>
  (t.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-z]{2,}/) || [])[0] || null;
const extractPhone = (t) =>
  (t.match(/(\+?\d{1,3}[\s-]?)?(\d{10}|\d{3}[\s-]\d{3}[\s-]\d{4})/) || [])[0] ||
  null;
const extractName = (t) => {
  const lines = t.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  for (let i = 0; i < Math.min(6, lines.length); i++) {
    const s = lines[i];
    if (!/resume/i.test(s) && /[A-Za-z]/.test(s) && s.split(" ").length <= 4)
      return s;
  }
  return null;
};

// 🧾 Routes
app.get("/", (req, res) => res.send("✅ AI Interview Backend is live!"));

// Parse resume
app.post("/api/parse-resume", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });
    const ext = path.extname(req.file.originalname).toLowerCase();
    let text = "";

    if (ext === ".pdf") {
      const data = fs.readFileSync(req.file.path);
      text = (await pdfParse(data)).text || "";
    } else if (ext === ".docx") {
      text = (await mammoth.extractRawText({ path: req.file.path })).value || "";
    } else {
      return res.status(400).json({ error: "Only PDF or DOCX allowed" });
    }

    const result = {
      name: extractName(text),
      email: extractEmail(text),
      phone: extractPhone(text),
      text,
    };

    res.json(result);
  } catch (err) {
    console.error("❌ Parse error:", err);
    res.status(500).json({ error: "Failed to parse resume" });
  }
});

// Generate questions
app.post("/api/generate-questions", async (req, res) => {
  try {
    const { role = "Full Stack Developer", stack = ["React", "Node.js"] } =
      req.body;
    const prompt = `Generate 6 ${role} interview questions for ${stack.join(
      ", "
    )}. Include easy, medium, and hard. Format JSON: [{"id":"q1","difficulty":"easy","text":"..."}]`;
    const result = await model.generateContent(prompt);
    const questions = extractJSON(result.response.text());
    res.json({ questions });
  } catch (err) {
    console.error("❌ Question error:", err);
    res.status(500).json({ error: "Gemini question generation failed" });
  }
});

// Grade answer
app.post("/api/grade-answer", async (req, res) => {
  try {
    const { question, answer } = req.body;
    if (!question || !answer)
      return res.status(400).json({ error: "Missing data" });
    const prompt = `Grade this answer 0–10 with 1 line feedback. Return JSON: {"score": number, "feedback": string}. Question: ${question} Answer: ${answer}`;
    const result = await model.generateContent(prompt);
    res.json(extractJSON(result.response.text()));
  } catch (err) {
    console.error("❌ Grade error:", err);
    res.status(500).json({ error: "Gemini grading failed" });
  }
});

// Final summary
app.post("/api/final-summary", async (req, res) => {
  try {
    const { candidate } = req.body;
    if (!candidate)
      return res.status(400).json({ error: "Missing candidate data" });
    const prompt = `Summarize interview for ${candidate.name}. Answers: ${JSON.stringify(
      candidate.answers
    )}. Return JSON: {"finalScorePercent": number, "summary": string}`;
    const result = await model.generateContent(prompt);
    res.json(extractJSON(result.response.text()));
  } catch (err) {
    console.error("❌ Summary error:", err);
    res.status(500).json({ error: "Gemini summary failed" });
  }
});

// 🚀 Vercel expects a default export
export default app;
