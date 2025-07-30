
const path = require("path")

console.log("🔍 Debugging environment variables...")
console.log("Current working directory:", process.cwd())
console.log("__dirname:", __dirname)


const envPaths = [".env", "./.env", path.join(__dirname, ".env"), path.join(process.cwd(), ".env")]

const fs = require("fs")

envPaths.forEach((envPath, index) => {
  console.log(`\n${index + 1}. Checking: ${envPath}`)
  try {
    if (fs.existsSync(envPath)) {
      console.log("   ✅ File exists")
      const content = fs.readFileSync(envPath, "utf8")
      console.log("   📄 Content preview:", content.substring(0, 100) + "...")
    } else {
      console.log("   ❌ File not found")
    }
  } catch (error) {
    console.log("   ❌ Error:", error.message)
  }
})


console.log("\n🔄 Testing dotenv loading...")
require("dotenv").config()
console.log("MONGODB_URI after dotenv:", process.env.MONGODB_URI ? "Found" : "Missing")
