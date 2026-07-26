import { BrowserRouter, Routes, Route } from 'react-router-dom'
import SubmitView from './pages/SubmitView'
import CloudView from './pages/CloudView'
import AdminView from './pages/AdminView'

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<SubmitView />} />
        <Route path="/feedback" element={<SubmitView />} />
        <Route path="/cloud" element={<CloudView />} />
        <Route path="/admin" element={<AdminView />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App
