const express = require("express")
const cors = require("cors")
const bcrypt = require("bcryptjs")
const jwt = require("jsonwebtoken")
const nodemailer = require("nodemailer")
const mongoose = require("mongoose")
const rateLimit = require("express-rate-limit")
const path = require("path")

// environment variables
require("dotenv").config()

const app = express()


if (process.env.NODE_ENV !== "production") {
  console.log("🔍 Environment check:")
  console.log("MONGODB_URI:", process.env.MONGODB_URI ? "Found" : "Missing")
  console.log("EMAIL_USER:", process.env.EMAIL_USER ? "Found" : "Missing")
  console.log("JWT_SECRET:", process.env.JWT_SECRET ? "Found" : "Missing")
}


const corsOptions = {
  origin: (origin, callback) => {
  
    if (!origin) return callback(null, true)

    const allowedOrigins = [
      "http://localhost:3000",
      "http://127.0.0.1:3000",
      process.env.FRONTEND_URL,
  
      "https://your-frontend-domain.vercel.app",
      "https://your-frontend-domain.netlify.app",
    ].filter(Boolean)

    if (allowedOrigins.includes(origin)) {
      callback(null, true)
    } else {
      callback(new Error("Not allowed by CORS"))
    }
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
}

app.use(cors(corsOptions))

// Add request logging middleware (only in development)
if (process.env.NODE_ENV !== "production") {
  app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`)
    next()
  })
}

app.use(express.json())

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: process.env.NODE_ENV === "production" ? 100 : 1000,
  message: "Too many requests from this IP, please try again later.",
})
app.use(limiter)

// MongoDB connection
const connectDB = async () => {
  try {
    console.log("🔄 Connecting to MongoDB...")

    if (!process.env.MONGODB_URI) {
      throw new Error("MONGODB_URI environment variable is not set")
    }

    await mongoose.connect(process.env.MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    })

    console.log("✅ Connected to MongoDB successfully!")
  } catch (error) {
    console.error("❌ MongoDB connection error:", error.message)
    process.exit(1)
  }
}

// Connect to database
connectDB()

// Handle MongoDB connection events
mongoose.connection.on("error", (err) => {
  console.error("MongoDB connection error:", err)
})

mongoose.connection.on("disconnected", () => {
  console.log("MongoDB disconnected")
})

// User Schema
const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    password: {
      type: String,
      required: function () {
        return !this.googleId
      },
    },
    dateOfBirth: {
      type: Date,
      required: function () {
        return !this.googleId
      },
    },
    googleId: {
      type: String,
      sparse: true,
    },
    isVerified: {
      type: Boolean,
      default: false,
    },
    otp: {
      code: String,
      expiresAt: Date,
    },
  },
  {
    timestamps: true,
  },
)

const User = mongoose.model("User", userSchema)

// Note Schema
const noteSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
    },
    content: {
      type: String,
      required: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
  },
  {
    timestamps: true,
  },
)

const Note = mongoose.model("Note", noteSchema)

// Email transporter setup
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
})

// Utility functions
const generateOTP = () => {
  return Math.floor(100000 + Math.random() * 900000).toString()
}

const generateToken = (userId) => {
  if (!process.env.JWT_SECRET) {
    throw new Error("JWT_SECRET environment variable is not set")
  }

  return jwt.sign({ userId }, process.env.JWT_SECRET, {
    expiresIn: "7d",
  })
}

const sendOTPEmail = async (email, otp, name) => {
  try {
    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: email,
      subject: "HD Notes - Email Verification OTP",
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background: #3b82f6; color: white; padding: 20px; text-align: center;">
            <h1>HD Notes</h1>
          </div>
          <div style="padding: 30px; background: #f8fafc;">
            <h2>Hello ${name}!</h2>
            <p>Thank you for signing up with HD Notes. Please use the following OTP to verify your email address:</p>
            <div style="background: white; padding: 20px; text-align: center; margin: 20px 0; border-radius: 8px;">
              <h1 style="color: #3b82f6; font-size: 32px; margin: 0;">${otp}</h1>
            </div>
            <p>This OTP will expire in 10 minutes.</p>
            <p>If you didn't request this, please ignore this email.</p>
          </div>
        </div>
      `,
    }
    await transporter.sendMail(mailOptions)
    console.log(`✅ OTP email sent to ${email}`)
  } catch (error) {
    console.error("❌ Email sending failed:", error)
    throw error
  }
}

// Middleware to verify JWT token
const authenticateToken = async (req, res, next) => {
  const authHeader = req.headers["authorization"]
  const token = authHeader && authHeader.split(" ")[1]

  if (!token) {
    return res.status(401).json({ message: "Access token required" })
  }

  try {
    if (!process.env.JWT_SECRET) {
      throw new Error("JWT_SECRET environment variable is not set")
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET)
    const user = await User.findById(decoded.userId).select("-password -otp")

    if (!user) {
      return res.status(401).json({ message: "Invalid token" })
    }

    req.user = user
    next()
  } catch (error) {
    return res.status(403).json({ message: "Invalid or expired token" })
  }
}

// Routes
// Send OTP for signup
app.post("/api/auth/send-otp", async (req, res) => {
  try {
    console.log("📧 OTP request received")
    const { email, name, dateOfBirth, password } = req.body

    // Validation
    if (!email || !name || !dateOfBirth || !password) {
      console.log("❌ Validation failed: Missing fields")
      return res.status(400).json({ message: "All fields are required" })
    }

    // Password validation
    if (password.length < 6) {
      return res.status(400).json({ message: "Password must be at least 6 characters" })
    }

    // Check if user already exists
    const existingUser = await User.findOne({ email })
    if (existingUser && existingUser.isVerified) {
      console.log("❌ User already exists:", email)
      return res.status(400).json({ message: "User already exists with this email" })
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 12)

    // Generate OTP
    const otp = generateOTP()
    const otpExpiresAt = new Date(Date.now() + 10 * 60 * 1000) // 10 minutes

    console.log(`🔢 Generated OTP for ${email}`)

    // Save or update user with OTP
    if (existingUser) {
      existingUser.name = name
      existingUser.dateOfBirth = new Date(dateOfBirth)
      existingUser.password = hashedPassword
      existingUser.otp = { code: otp, expiresAt: otpExpiresAt }
      await existingUser.save()
      console.log("✅ Updated existing user with OTP")
    } else {
      const newUser = new User({
        name,
        email,
        dateOfBirth: new Date(dateOfBirth),
        password: hashedPassword,
        otp: { code: otp, expiresAt: otpExpiresAt },
      })
      await newUser.save()
      console.log("✅ Created new user with OTP")
    }

    // Send OTP email
    await sendOTPEmail(email, otp, name)

    res.status(200).json({ message: "OTP sent successfully" })
  } catch (error) {
    console.error("❌ Send OTP error:", error)
    res.status(500).json({ message: "Failed to send OTP", error: error.message })
  }
})

// Verify OTP and complete signup
app.post("/api/auth/signup", async (req, res) => {
  try {
    console.log("🔐 Signup request received")
    const { email, otp } = req.body

    // Validation
    if (!email || !otp) {
      return res.status(400).json({ message: "Email and OTP are required" })
    }

    // Find user
    const user = await User.findOne({ email })
    if (!user) {
      return res.status(400).json({ message: "User not found" })
    }

    // Check OTP
    if (!user.otp || user.otp.code !== otp) {
      return res.status(400).json({ message: "Invalid OTP" })
    }

    if (user.otp.expiresAt < new Date()) {
      return res.status(400).json({ message: "OTP has expired" })
    }

    // Verify user and clear OTP
    user.isVerified = true
    user.otp = undefined
    await user.save()

    // Generate JWT token
    const token = generateToken(user._id)

    console.log("✅ User signup completed:", email)

    res.status(201).json({
      message: "Account created successfully",
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        dateOfBirth: user.dateOfBirth,
      },
    })
  } catch (error) {
    console.error("❌ Signup error:", error)
    res.status(500).json({ message: "Signup failed", error: error.message })
  }
})

// Sign in
app.post("/api/auth/signin", async (req, res) => {
  try {
    console.log("🔑 Signin request received")
    const { email, password } = req.body

    // Validation
    if (!email || !password) {
      return res.status(400).json({ message: "Email and password are required" })
    }

    // Find user
    const user = await User.findOne({ email })
    if (!user || !user.isVerified) {
      return res.status(400).json({ message: "Invalid credentials" })
    }

    // Check password
    const isPasswordValid = await bcrypt.compare(password, user.password)
    if (!isPasswordValid) {
      return res.status(400).json({ message: "Invalid credentials" })
    }

    // Generate JWT token
    const token = generateToken(user._id)

    console.log("✅ User signin successful:", email)

    res.status(200).json({
      message: "Sign in successful",
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        dateOfBirth: user.dateOfBirth,
      },
    })
  } catch (error) {
    console.error("❌ Sign in error:", error)
    res.status(500).json({ message: "Sign in failed", error: error.message })
  }
})

// Get user profile
app.get("/api/auth/profile", authenticateToken, async (req, res) => {
  try {
    res.status(200).json({
      user: {
        id: req.user._id,
        name: req.user.name,
        email: req.user.email,
        dateOfBirth: req.user.dateOfBirth,
      },
    })
  } catch (error) {
    console.error("Profile error:", error)
    res.status(500).json({ message: "Failed to get profile" })
  }
})

// Get all notes for authenticated user
app.get("/api/notes", authenticateToken, async (req, res) => {
  try {
    const notes = await Note.find({ userId: req.user._id }).sort({ createdAt: -1 })

    res.status(200).json({ notes })
  } catch (error) {
    console.error("Get notes error:", error)
    res.status(500).json({ message: "Failed to fetch notes" })
  }
})

// Create a new note
app.post("/api/notes", authenticateToken, async (req, res) => {
  try {
    const { title, content } = req.body

    // Validation
    if (!title || !content) {
      return res.status(400).json({ message: "Title and content are required" })
    }

    const note = new Note({
      title: title.trim(),
      content: content.trim(),
      userId: req.user._id,
    })

    await note.save()

    res.status(201).json({
      message: "Note created successfully",
      note: {
        id: note._id,
        title: note.title,
        content: note.content,
        createdAt: note.createdAt,
        updatedAt: note.updatedAt,
      },
    })
  } catch (error) {
    console.error("Create note error:", error)
    res.status(500).json({ message: "Failed to create note" })
  }
})

// Update a note
app.put("/api/notes/:id", authenticateToken, async (req, res) => {
  try {
    const { title, content } = req.body
    const noteId = req.params.id

    // Validation
    if (!title || !content) {
      return res.status(400).json({ message: "Title and content are required" })
    }

    const note = await Note.findOne({ _id: noteId, userId: req.user._id })
    if (!note) {
      return res.status(404).json({ message: "Note not found" })
    }

    note.title = title.trim()
    note.content = content.trim()
    await note.save()

    res.status(200).json({
      message: "Note updated successfully",
      note: {
        id: note._id,
        title: note.title,
        content: note.content,
        createdAt: note.createdAt,
        updatedAt: note.updatedAt,
      },
    })
  } catch (error) {
    console.error("Update note error:", error)
    res.status(500).json({ message: "Failed to update note" })
  }
})

// Delete a note
app.delete("/api/notes/:id", authenticateToken, async (req, res) => {
  try {
    const noteId = req.params.id

    const note = await Note.findOneAndDelete({ _id: noteId, userId: req.user._id })
    if (!note) {
      return res.status(404).json({ message: "Note not found" })
    }

    res.status(200).json({ message: "Note deleted successfully" })
  } catch (error) {
    console.error("Delete note error:", error)
    res.status(500).json({ message: "Failed to delete note" })
  }
})

// Google OAuth routes (placeholder)
app.get("/api/auth/google", (req, res) => {
  // Redirect to Google OAuth
  res.redirect(
    `https://accounts.google.com/oauth/authorize?client_id=${process.env.GOOGLE_CLIENT_ID}&redirect_uri=${process.env.GOOGLE_REDIRECT_URI}&scope=email profile&response_type=code`,
  )
})

app.get("/api/auth/google/callback", async (req, res) => {
  // Handle Google OAuth callback
  // This is a simplified version - in production, you'd exchange the code for tokens
  res.redirect(`${process.env.FRONTEND_URL || "http://localhost:3000"}/dashboard`)
})

// Health check
app.get("/api/health", (req, res) => {
  console.log("🏥 Health check requested")
  res.status(200).json({
    message: "Server is running",
    timestamp: new Date().toISOString(),
    mongodb: mongoose.connection.readyState === 1 ? "connected" : "disconnected",
    environment: process.env.NODE_ENV || "development",
  })
})

// Error handling middleware
app.use((err, req, res, next) => {
  console.error("❌ Unhandled error:", err.stack)
  res.status(500).json({
    message: "Something went wrong!",
    error: process.env.NODE_ENV === "production" ? "Internal server error" : err.message,
  })
})

// 404 handler
app.use("*", (req, res) => {
  console.log("❌ 404 - Route not found:", req.originalUrl)
  res.status(404).json({ message: "Route not found" })
})

const PORT = process.env.PORT || 5000
app.listen(PORT, () => {
  console.log(`🚀 Server is running on port ${PORT}`)
  console.log(`🌐 Health check: http://localhost:${PORT}/api/health`)
  console.log(`🔧 Environment: ${process.env.NODE_ENV || "development"}`)
})

module.exports = app
