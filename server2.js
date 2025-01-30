require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const bodyParser = require("body-parser");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcrypt");
const multer = require("multer");
const { v2: cloudinary } = require("cloudinary");
const twilio = require("twilio");
const fs = require("fs");
const path = require("path");

// Twilio credentials (hardcoded for now, move to environment variables for security)
const accountSid = "AC29edd84ce0d3c92d9d6dee79f10b8a60";
const authToken = "d16fa827410aca4ee6cbae8142500be5";
const twilioPhoneNumber = "+17655483708";
const notificationPhoneNumber = "+918826417060";

// Initialize Twilio client
const client = twilio(accountSid, authToken);

// Initialize Express app
const app = express();

// CORS Configuration
const corsOptions = {
  origin: "http://localhost:3000", 
  methods: "GET,POST",
  allowedHeaders: "Content-Type,Authorization",
};
app.use(cors(corsOptions));

// Middleware
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

// MongoDB Schema and Models
const userSchema = new mongoose.Schema({
  name: String,
  aadharNumber: String,
  phoneNumber: String,
  password: String,
  verified: Boolean,
  otp: String,
  otpExpiry: Date,
});
const recordingSchema = new mongoose.Schema({
  videoUrl: String,
  name: String,
  phoneNumber: String,
  latitude: Number,
  longitude: Number,
  time: String,
});
const User = mongoose.model("User", userSchema);
const Recording = mongoose.model("Recording", recordingSchema);

// Multer Storage Configuration
const storage = multer.memoryStorage();
const upload = multer({ storage });

// JWT Authentication Middleware
const authenticateToken = (req, res, next) => {
  const token = req.headers.authorization?.split(" ")[1] || "";
  if (!token) return res.status(401).json({ error: "Access denied. No token provided." });

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: "Invalid token." });
    req.user = user;
    next();
  });
};

// Load Aadhar Data
const aadharDataPath = path.join(__dirname, "./aadhar_data/aadhar_data.json");
let aadharData = [];
if (fs.existsSync(aadharDataPath)) {
  aadharData = JSON.parse(fs.readFileSync(aadharDataPath, "utf8"));
} else {
  console.error("❌ Aadhar data file not found!");
}

// Routes

// Route: User Signup
app.post("/signup", async (req, res) => {
  try {
    const { name, aadharNumber, phoneNumber, password } = req.body;

    if (!name || !aadharNumber || !phoneNumber || !password) {
      return res.status(400).json({ error: "All fields are required" });
    }

    // Check if the user exists in aadhar_data.json
    const aadharUser = aadharData.find(
      (user) =>
        user.Name.trim() === name.trim() &&
        user.AadharNumber.trim() === aadharNumber.trim() &&
        user.PhoneNumber.trim() === phoneNumber.trim()
    );

    if (!aadharUser) {
      return res.status(403).json({ error: "User not found in Aadhar records" });
    }

    // Check if user already exists in MongoDB
    const existingUser = await User.findOne({ phoneNumber });
    if (existingUser) {
      return res.status(400).json({ error: "User with this phone number already exists" });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Save user in MongoDB
    const user = new User({
      name,
      aadharNumber,
      phoneNumber,
      password: hashedPassword,
      verified: false,
    });

    await user.save();
    res.status(201).json({ message: "Signup successful" });
  } catch (error) {
    console.error("❌ Signup error:", error);
    res.status(500).json({ error: "Signup failed" });
  }
});

// Route: Login
app.post("/login", async (req, res) => {
  try {
    const { phoneNumber, password } = req.body;
    const user = await User.findOne({ phoneNumber });

    if (!user) return res.status(404).json({ error: "User not found" });

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) return res.status(401).json({ error: "Invalid credentials" });

    const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, { expiresIn: "1h" });

    res.status(200).json({ message: "Login successful", token });
  } catch (error) {
    console.error("❌ Login error:", error);
    res.status(500).json({ error: "Login failed" });
  }
});

// Route: Upload Video and Save Metadata
app.post("/upload", upload.single("file"), async (req, res) => {
  try {
    const { latitude, longitude, time, name, phoneNumber } = req.body;
    const file = req.file;

    if (!file) {
      return res.status(400).json({ error: "No file uploaded" });
    }
    if (!latitude || !longitude || !time) {
      return res.status(400).json({ error: "Missing metadata (latitude, longitude, or time)" });
    }

    // Upload video to Cloudinary
    const uploadResponse = await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        { resource_type: "video" },
        (error, result) => {
          if (error) {
            return reject(error);
          }
          return resolve(result);
        }
      );
      stream.end(file.buffer);
    });

    const videoUrl = uploadResponse.secure_url;

    // Save metadata to MongoDB
    const newRecording = new Recording({ videoUrl, name, phoneNumber, latitude, longitude, time });
    await newRecording.save();

    // Generate Google Maps link
    const googleMapsLink = `https://www.google.com/maps?q=${latitude},${longitude}`;

    // Send SMS notification
    const message = `New video uploaded!\n\nURL: ${videoUrl}\nLatitude: ${latitude}\nLongitude: ${longitude}\nGoogle Maps: ${googleMapsLink}`;
    await client.messages.create({
      body: message,
      from: twilioPhoneNumber,
      to: notificationPhoneNumber,
    });

    res.status(200).json({ message: "Upload successful", recording: newRecording });
  } catch (error) {
    console.error("❌ Upload error:", error);
    res.status(500).json({ error: "Failed to upload video" });
  }
});

// Route: Fetch All Recordings
app.get("/recordings", authenticateToken, async (req, res) => {
  try {
    const recordings = await Recording.find();
    res.status(200).json(recordings);
  } catch (error) {
    console.error("❌ Fetch error:", error);
    res.status(500).json({ error: "Failed to fetch recordings" });
  }
});

// Start the Server
const PORT = process.env.PORT || 8000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
