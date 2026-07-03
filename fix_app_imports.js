const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf8');

code = code.replace("import Sidebar from './components/Sidebar';", "import Sidebar from './components/layout/Sidebar';");
code = code.replace("import DashboardView from './views/Dashboard';", "import DashboardView from './features/dashboard/Dashboard';");
code = code.replace("import SourcesView from './views/Sources';", "import SourcesView from './features/sources/Sources';");
code = code.replace("import RunsView from './views/Runs';", "import RunsView from './features/briefings/Runs';");
code = code.replace("import BriefingDetailView from './views/BriefingDetail';", "import BriefingDetailView from './features/briefings/BriefingDetail';");
code = code.replace("import SettingsView from './views/Settings';", "import SettingsView from './features/settings/Settings';");
code = code.replace("import AudioPlayer from './components/AudioPlayer';", "import AudioPlayer from './features/audio/AudioPlayer';");

fs.writeFileSync('src/App.tsx', code);
