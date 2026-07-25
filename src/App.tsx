import { BrowserRouter, Routes, Route } from 'react-router-dom'
import SubmitView from './pages/SubmitView'
import CloudView from './pages/CloudView'

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<SubmitView />} />
        <Route path="/cloud" element={<CloudView />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App
