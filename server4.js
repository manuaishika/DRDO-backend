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

// Initialize Express app
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

// MongoDB Schema for User Authentication
const userSchema = new mongoose.Schema({
  name: String,
  phoneNumber: String,
  aadharNumber: String,
  password: String,
  otp: String,
});

const User = mongoose.model("User", userSchema);

app.get("/", (req, res) => {
  res.status(200).json({ message: "Server is running successfully!" });
});

// 📌 **Normal Route (GET)**
app.get("/normal", (req, res) => {
  console.log("📝 Accessed normal route");
  res.status(200).json({ message: "This is a normal route!" });
});

// 📌 **Signup Route (With Aadhar Verification)**
app.post("/signup", async (req, res) => {
  try {
    const { name, phoneNumber, aadharNumber, password } = req.body;

    if (!name || !phoneNumber || !aadharNumber || !password) {
      return res.status(400).json({ error: "All fields are required" });
    }

    console.log("📝 Checking if user exists...");
    const existingUser = await User.findOne({ phoneNumber });
    if (existingUser) {
      console.log("❌ User already exists");
      return res.status(400).json({ error: "User already exists" });
    }

    console.log("✅ User not found, hashing password...");
    const hashedPassword = await bcrypt.hash(password, 10);

    console.log("📝 Saving new user...");
    const user = new User({
      name,
      phoneNumber,
      aadharNumber,
      password: hashedPassword,
    });

    await user.save();
    console.log("✅ Signup successful");

    res.status(201).json({ message: "Signup successful" });
  } catch (error) {
    console.error("❌ Signup error:", error);
    res.status(500).json({ error: "Signup failed" });
  }
});

// 📌 **Login Route (With Password)**
app.post("/login", async (req, res) => {
  try {
    const { phoneNumber, password } = req.body;
    console.log("📝 Attempting login...");

    const user = await User.findOne({ phoneNumber });
    if (!user) {
      console.log("❌ User not found");
      return res.status(404).json({ error: "User not found" });
    }

    const isPasswordCorrect = await bcrypt.compare(password, user.password);
    if (!isPasswordCorrect) {
      console.log("❌ Incorrect password");
      return res.status(400).json({ error: "Incorrect password" });
    }

    const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, { expiresIn: "1h" });
    console.log("✅ Login successful, JWT generated");

    res.status(200).json({ message: "Login successful", token });
  } catch (error) {
    console.error("❌ Login error:", error);
    res.status(500).json({ error: "Login failed" });
  }
});

// 📌 **Verify OTP & Generate JWT**
app.post("/verify-otp", async (req, res) => {
  try {
    const { phoneNumber, otp } = req.body;
    console.log("📝 Verifying OTP...");

    const user = await User.findOne({ phoneNumber });
    if (!user) return res.status(404).json({ error: "User not found" });
    if (user.otp !== otp) return res.status(400).json({ error: "Invalid OTP" });

    const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, { expiresIn: "1h" });
    console.log("✅ OTP verified, JWT generated");

    res.status(200).json({ message: "Login successful", token });
  } catch (error) {
    console.error("❌ OTP verification error:", error);
    res.status(500).json({ error: "OTP verification failed" });
  }
});

// MongoDB Schema for Video Uploads
const recordingSchema = new mongoose.Schema({
  videoUrl: String,
  latitude: Number,
  longitude: Number,
  time: String,
});

const Recording = mongoose.model("Recording", recordingSchema);

// Multer Storage Configuration
const storage = multer.memoryStorage();
const upload = multer({ storage });

// 📌 **Upload Video Route**
app.post("/upload", upload.single("file"), async (req, res) => {
  try {
    const { latitude, longitude, time } = req.body;
    const file = req.file;

    if (!file) {
      console.log("❌ No file uploaded");
      return res.status(400).json({ error: "No file uploaded" });
    }
    if (!latitude || !longitude || !time) {
      console.log("❌ Missing metadata");
      return res.status(400).json({ error: "Missing metadata (latitude, longitude, or time)" });
    }

    console.log("🌍 Metadata received:", { latitude, longitude, time });

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
    console.log("✅ Video uploaded to Cloudinary:", videoUrl);

    const newRecording = new Recording({ videoUrl, latitude, longitude, time });
    await newRecording.save();
    console.log("✅ Metadata saved successfully:", newRecording);

    const googleMapsLink = `https://www.google.com/maps?q=${latitude},${longitude}`;
    console.log("🌍 Google Maps link:", googleMapsLink);

    const message = `New video uploaded!\n\nURL: ${videoUrl}\nLatitude: ${latitude}\nLongitude: ${longitude}\nGoogle Maps: ${googleMapsLink}`;
    try {
      const smsResponse = await client.messages.create({
        body: message,
        from: twilioPhoneNumber,
        to: "+918826417060", // Hardcoded number
      });
      console.log("✅ SMS sent successfully:", smsResponse.sid);
    } catch (smsError) {
      console.error("❌ Error sending SMS:", smsError.message);
    }

    res.status(200).json({ message: "Upload successful and SMS sent!", recording: newRecording });
  } catch (error) {
    console.error("❌ Upload error:", error);
    res.status(500).json({ error: "Failed to upload video" });
  }
});

// 📌 **Fetch All Recordings**
app.get("/recordings", async (req, res) => {
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
