#include "nmea_adapter.hpp"

#include <chrono>
#include <ctime>
#include <iomanip>
#include <sstream>
#include <utility>

namespace airboat::nmea {

namespace {

std::string now_iso8601_utc() {
    const auto now = std::chrono::system_clock::now();
    const std::time_t now_time = std::chrono::system_clock::to_time_t(now);
    std::tm tm{};
#if defined(_WIN32)
    gmtime_s(&tm, &now_time);
#else
    gmtime_r(&now_time, &tm);
#endif
    std::ostringstream out;
    out << std::put_time(&tm, "%Y-%m-%dT%H:%M:%SZ");
    return out.str();
}

}  // namespace

CanboatJsonAdapter::CanboatJsonAdapter(std::string input_path)
    : input_path_(std::move(input_path)) {}

SensorState CanboatJsonAdapter::read() {
    // TODO: parse CANboat analyzer JSON and map relevant NMEA2000 PGNs into SensorState.
    // Expected PGNs include GNSS position, COG/SOG, heading, water depth, engine rpm and fuel rate.
    (void)input_path_;
    return offline_sensor_state("canboat_json_adapter", "CANboat parser is not implemented yet");
}

SensorState offline_sensor_state(const std::string& source, const std::string& reason) {
    const std::string updated_at = now_iso8601_utc();
    SensorState state;
    state.nmea.online = false;
    state.nmea.source = source + ":" + reason;
    state.nmea.last_frame_age_ms = 0;
    state.nmea.updated_at = updated_at;
    state.position.updated_at = updated_at;
    state.motion.updated_at = updated_at;
    state.depth.updated_at = updated_at;
    state.engine.updated_at = updated_at;
    return state;
}

}  // namespace airboat::nmea
