mkdir -p src/features/dashboard src/features/sources src/features/briefings src/features/settings src/features/audio src/components/layout src/services/api src/services/mock

mv src/views/Dashboard.tsx src/features/dashboard/
mv src/views/Sources.tsx src/features/sources/
mv src/views/BriefingDetail.tsx src/features/briefings/
mv src/views/Runs.tsx src/features/briefings/
mv src/views/Settings.tsx src/features/settings/

mv src/components/AudioPlayer.tsx src/features/audio/
mv src/components/OrbVisualizer.tsx src/features/audio/
mv src/components/Sidebar.tsx src/components/layout/

rm -rf src/views

