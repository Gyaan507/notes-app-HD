const bcrypt = require("bcryptjs")
const nodemailer = require("nodemailer")
const mongoose = require("mongoose")

// MongoDB connection
let cachedConnection = null

async function connectToDatabase() {
  if (cachedConnection) {
    return cachedConnection
  }

  try {
    const connection = await mongoose.connect(process.env.MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    })
    cachedConnection = connection
    return connection
  } catch (error) {
    console.error("Database connection error:", error)
    throw error
  }
}

// User Schema
const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
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
    googleId: { type: String, sparse: true },
    isVerified: { type: Boolean, default: false },
    otp: {
      code: String,
      expiresAt: Date,
    },
  },
  { timestamps: true },
)

const User = mongoose.models.User || mongoose.model("User", userSchema)

// Email transporter
const transporter = nodemailer.createTransporter({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
})

const generateOTP = () => {
  return Math.floor(100000 + Math.random() * 900000).toString()
}

const sendOTPEmail = async (email, otp, name) => {
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
}

export default async function handler(req, res) {
  // Enable CORS
  res.setHeader("Access-Control-Allow-Credentials", true)
  res.setHeader("Access-Control-Allow-Origin", "*")
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS,PATCH,DELETE,POST,PUT")
  res.setHeader(
    "Access-Control-Allow-Headers",
    "X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization",
  )

  if (req.method === "OPTIONS") {
    res.status(200).end()
    return
  }

  if (req.method !== "POST") {
    return res.status(405).json({ message: "Method not allowed" })
  }

  try {
    await connectToDatabase()

    const { email, name, dateOfBirth, password } = req.body

    // Validation
    if (!email || !name || !dateOfBirth || !password) {
      return res.status(400).json({ message: "All fields are required" })
    }

    if (password.length < 6) {
      return res.status(400).json({ message: "Password must be at least 6 characters" })
    }

    // Check if user already exists
    const existingUser = await User.findOne({ email })
    if (existingUser && existingUser.isVerified) {
      return res.status(400).json({ message: "User already exists with this email" })
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 12)

    // Generate OTP
    const otp = generateOTP()
    const otpExpiresAt = new Date(Date.now() + 10 * 60 * 1000) // 10 minutes

    // Save or update user with OTP
    if (existingUser) {
      existingUser.name = name
      existingUser.dateOfBirth = new Date(dateOfBirth)
      existingUser.password = hashedPassword
      existingUser.otp = { code: otp, expiresAt: otpExpiresAt }
      await existingUser.save()
    } else {
      const newUser = new User({
        name,
        email,
        dateOfBirth: new Date(dateOfBirth),
        password: hashedPassword,
        otp: { code: otp, expiresAt: otpExpiresAt },
      })
      await newUser.save()
    }

    // Send OTP email
    await sendOTPEmail(email, otp, name)

    res.status(200).json({ message: "OTP sent successfully" })
  } catch (error) {
    console.error("Send OTP error:", error)
    res.status(500).json({ message: "Failed to send OTP", error: error.message })
  }
}
