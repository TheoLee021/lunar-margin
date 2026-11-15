import type { Schedule } from '../mission/types'
import SearchView from './SearchView'
import '../mission/orbit-workspace.css'

type Props = {
  schedule: Schedule
  onBack: () => void
}

export default function SearchWorkspace({ schedule, onBack }: Props) {
  return (
    <main className="orbit-workspace">
      <div className="orbit-page-content">
        <header className="orbit-page-header">
          <div>
            <p>Lunar Margin</p>
            <h1>남극 착륙 후보지 탐색</h1>
            <span>
              임무 조건으로 후보지를 찾고, 선정 과정을 지도에서 단계별로
              확인하세요.
            </span>
          </div>
          <button type="button" className="hud-button" onClick={onBack}>
            미션 대시보드
          </button>
        </header>
        <div className="pt-6">
          <SearchView schedule={schedule} />
        </div>
      </div>
    </main>
  )
}
