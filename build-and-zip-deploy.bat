@echo off
setlocal

:: Step 1: Build the Vite project
echo 🔨 Building project using Vite...
call npm run build

:: Step 2: Remove previous deploy folder if it exists
echo 🧼 Cleaning previous deploy folder...
rmdir /s /q deploy
mkdir deploy

:: Step 3: Copy contents of dist/ into deploy/
echo 📁 Copying build files to deploy/...
xcopy /E /I /Y dist\* deploy\

:: Step 4: Copy vercel.json to deploy/
if exist vercel.json (
    echo 📦 Copying vercel.json...
    copy vercel.json deploy\
) else (
    echo ⚠️ vercel.json not found in root directory!
)

:: Step 5: Zip deploy folder to deploy.zip
echo 🗜️ Zipping deploy folder...
powershell -Command "Compress-Archive -Path deploy\* -DestinationPath deploy.zip -Force"

:: Step 6: Open Vercel manual upload page
echo 🌐 Opening Vercel upload page in browser...
start https://vercel.com/new/project?template=manual

echo ✅ Done! You can now upload deploy.zip to Vercel manually.
pause
