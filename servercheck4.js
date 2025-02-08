require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const bodyParser = require("body-parser");
const cors = require("cors");
const multer = require("multer");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const { v2: cloudinary } = require("cloudinary");
const twilio = require("twilio");

// Twilio Credentials
const accountSid = "AC29edd84ce0d3c92d9d6dee79f10b8a60";
const authToken = "d16fa827410aca4ee6cbae8142500be5";
const twilioPhoneNumber = "+17655483708";

// Initialize Twilio client
const client = twilio(accountSid, authToken);

const app = express();

// CORS Configuration
const corsOptions = {
  origin: "*",
  methods: "GET,POST",
  allowedHeaders: "Content-Type,Authorization",
};
app.use(cors(corsOptions));
app.use(bodyParser.json());

// MongoDB Connection
mongoose
  .connect(process.env.MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log("✅ MongoDB connected successfully"))
  .catch((err) => {
    console.error("❌ MongoDB connection error:", err);
    process.exit(1);
  });

// Cloudinary Configuration
cloudinary.config({
  cloud_name: process.env.CLOUD_NAME,
  api_key: process.env.CLOUD_API_KEY,
  api_secret: process.env.CLOUD_API_SECRET,
});
console.log("✅ Cloudinary configured successfully");

// User Schema
const userSchema = new mongoose.Schema({
  name: String,
  phoneNumber: String,
  aadharNumber: String,
  password: String,
  otp: String,
});

const User = mongoose.model("User", userSchema);

// Load predefined users data
const predefinedUsers = require("./aadhar_data/aadhar_data.json");

app.get("/", (req, res) => {
  res.status(200).json({ message: "Server is running successfully!" });
});

// Signup Route (With Aadhar Verification)
app.post("/signup", async (req, res) => {
  try {
    const { name, phoneNumber, aadharNumber, password } = req.body;

    if (!name || !phoneNumber || !aadharNumber || !password) {
      return res.status(400).json({ error: "All fields are required" });
    }

    const validUser = predefinedUsers.find(
      (user) =>
        user.Name === name &&
        user.PhoneNumber === phoneNumber &&
        user.AadharNumber === aadharNumber
    );

    if (!validUser) {
      return res.status(400).json({ error: "User details do not match records" });
    }

    const existingUser = await User.findOne({ phoneNumber });
    if (existingUser) {
      return res.status(400).json({ error: "User already exists" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const user = new User({
      name,
      phoneNumber,
      aadharNumber,
      password: hashedPassword,
    });

    await user.save();
    res.status(201).json({ message: "Signup successful" });
  } catch (error) {
    console.error("❌ Signup error:", error);
    res.status(500).json({ error: "Signup failed" });
  }
});

// Login Route
app.post("/login", async (req, res) => {
  try {
    const { phoneNumber, password } = req.body;
    
    const user = await User.findOne({ phoneNumber });
    if (!user) return res.status(404).json({ error: "User not found" });

    const isPasswordCorrect = await bcrypt.compare(password, user.password);
    if (!isPasswordCorrect) return res.status(400).json({ error: "Incorrect password" });

    const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, { expiresIn: "1h" });
    res.status(200).json({ message: "Login successful", token });
  } catch (error) {
    console.error("❌ Login error:", error);
    res.status(500).json({ error: "Login failed" });
  }
});

// Recording Schema
const recordingSchema = new mongoose.Schema({
  videoUrl: String,
  latitude: Number,
  longitude: Number,
  time: String,
});

const Recording = mongoose.model("Recording", recordingSchema);

// Upload Video Route
app.post("/upload", multer({ storage: multer.memoryStorage() }).single("file"), async (req, res) => {
  try {
    const { latitude, longitude, time } = req.body;
    const file = req.file;
    
    if (!file) {
      return res.status(400).json({ error: "No file uploaded" });
    }
    
    if (!latitude || !longitude || !time) {
      return res.status(400).json({ error: "Missing metadata (latitude, longitude, or time)" });
    }

    const uploadResponse = await new Promise((resolve, reject) => {
      cloudinary.uploader.upload_stream({ resource_type: "video" }, (error, result) => {
        if (error) reject(error);
        resolve(result);
      }).end(file.buffer);
    });
    
    const newRecording = new Recording({ videoUrl: uploadResponse.secure_url, latitude, longitude, time });
    await newRecording.save();
    res.status(200).json({ message: "Upload successful", recording: newRecording });
  } catch (error) {
    console.error("❌ Upload error:", error);
    res.status(500).json({ error: "Failed to upload video" });
  }
});

// Fetch All Recordings
app.get("/recordings", async (req, res) => {
  try {
    const recordings = await Recording.find();
    res.status(200).json(recordings);
  } catch (error) {
    console.error("❌ Fetch error:", error);
    res.status(500).json({ error: "Failed to fetch recordings" });
  }
});

const PORT = process.env.PORT || 8000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
