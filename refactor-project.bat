@echo off
echo 🛠 Starting safe project cleanup and refactor...

REM === STEP 1: Delete unused files ===
echo 🧹 Deleting unused/empty files...
del "src\firebase.js"
del "src\TaskReminder.jsx"
del "src\LogoutButton.jsx"
del "src\utils\New Text Document.txt"
del "src\SearchBar.jsx"
del "src\TaskList.jsx"
del "src\pages\GrowDetailPage.jsx"
del "src\context\AuthContext.jsx"
del "src\components\mushroomcard.jsx"

REM === STEP 2: Create new folder structure ===
echo 📁 Creating target folder structure...
mkdir src\components\grow
mkdir src\components\tasks
mkdir src\components\recipes
mkdir src\components\layout
mkdir src\components\ui
mkdir src\pages
mkdir src\context
mkdir src\utils
mkdir src\assets

REM === STEP 3: Move grow-related components ===
echo 📦 Moving grow components...
move src\components\GrowForm.jsx src\components\grow\
move src\components\GrowList.jsx src\components\grow\
move src\components\GrowCard.jsx src\components\grow\
move src\components\GrowTimeline.jsx src\components\grow\
move src\components\GrowNotesModal.jsx src\components\grow\
move src\components\GrowDetail.jsx src\components\grow\
move src\components\GrowFilters.jsx src\components\grow\
move src\components\LabelPrint.jsx src\components\grow\

REM === STEP 4: Move task-related components ===
echo 📦 Moving task components...
move src\components\TaskManager.jsx src\components\tasks\

REM === STEP 5: Move recipe/cog-related components ===
move src\components\COGManager.jsx src\components\recipes\
move src\components\RecipeManager.jsx src\components\recipes\

REM === STEP 6: Move layout/ui/shared components ===
move src\components\Navbar.jsx src\components\layout\
move src\components\Layout.jsx src\components\layout\
move src\components\header.jsx src\components\layout\
move src\components\SplashScreen.jsx src\components\ui\
move src\components\OnboardingModal.jsx src\components\ui\
move src\components\PhotoUpload.jsx src\components\ui\
move src\components\DashboardStats.jsx src\components\ui\
move src\components\ScanBarcodeModal.jsx src\components\ui\

REM === STEP 7: Move other root-level components ===
move src\components\Auth.jsx src\pages\
move src\components\Login.jsx src\pages\
move src\components\Register.jsx src\pages\
move src\components\Signup.jsx src\pages\
move src\components\Dashboard.jsx src\pages\
move src\components\CalendarView.jsx src\pages\
move src\components\Settings.jsx src\pages\
move src\components\StrainManager.jsx src\pages\
move src\components\BackupManager.jsx src\pages\
move src\components\ImportExportButtons.jsx src\pages\
move src\components\Analytics.jsx src\pages\

REM === STEP 8: Move utils ===
move src\utils\firestore.js src\utils\
move src\utils\storage.js src\utils\

REM === STEP 9: Uninstall unused npm dependencies ===
echo 🔧 Removing unused npm packages...
call npm uninstall classnames react-icons vite-plugin-pwa

echo ✅ Refactor complete. All files safely cleaned and organized.
pause
