// fast-sampler.swift — can this Mac be read faster than once per second, without root?
//
// The daemon gets 1 Hz because it parses the text of `iostat`, `vm_stat` and `nettop`,
// which only print once per second or slower. The kernel itself keeps these counters
// continuously. This program reads three of them directly and reports what it finds:
//
//   CPU     host_processor_info   per-core tick counters (user / system / idle / nice)
//   Memory  host_statistics64     page faults, page-ins, page-outs, compressions
//   Network getifaddrs            bytes in and out of every interface except loopback
//
// For each source it prints: how long one read costs, how often the value had changed
// since the previous read (this is the real update rate), and the biggest burst seen at
// the fast rate against the biggest burst a 1-second reader would have seen.
//
//   swiftc -O -o bin/fast-sampler src/fast-sampler.swift
//   ./bin/fast-sampler 20 10        # 20 reads per second, for 10 seconds
//
// Do something while it runs (open an app, scroll, build something) so there is signal.
// Nothing here needs sudo. Disk statistics (IOKit) are left out on purpose, to keep
// this one short; add them if the three below look good.

import Foundation
import Darwin

let HZ: Double   = Double(CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "20") ?? 20
let SECS: Double = Double(CommandLine.arguments.count > 2 ? CommandLine.arguments[2] : "10") ?? 10

func nowNs() -> UInt64 { DispatchTime.now().uptimeNanoseconds }

// ---------------------------------------------------------------- readers

/// Per-core tick counters: [core][user, system, idle, nice]. Counters wrap at 2^32.
func cpuTicks() -> [[UInt32]]? {
    var cpuCount: natural_t = 0
    var info: processor_info_array_t? = nil
    var infoCount: mach_msg_type_number_t = 0
    let r = host_processor_info(mach_host_self(), PROCESSOR_CPU_LOAD_INFO, &cpuCount, &info, &infoCount)
    guard r == KERN_SUCCESS, let base = info else { return nil }
    let states = Int(CPU_STATE_MAX)
    var out: [[UInt32]] = []
    for c in 0..<Int(cpuCount) {
        var row: [UInt32] = []
        for s in 0..<states { row.append(UInt32(bitPattern: base[c * states + s])) }
        out.append(row)
    }
    let bytes = vm_size_t(infoCount) * vm_size_t(MemoryLayout<integer_t>.stride)
    vm_deallocate(mach_task_self_, vm_address_t(UInt(bitPattern: base)), bytes)
    return out
}

/// Cumulative virtual-memory counters since boot.
func vmStats() -> vm_statistics64? {
    var stats = vm_statistics64()
    var count = mach_msg_type_number_t(MemoryLayout<vm_statistics64>.stride / MemoryLayout<integer_t>.stride)
    let r = withUnsafeMutablePointer(to: &stats) { p -> kern_return_t in
        p.withMemoryRebound(to: integer_t.self, capacity: Int(count)) { q in
            host_statistics64(mach_host_self(), HOST_VM_INFO64, q, &count)
        }
    }
    return r == KERN_SUCCESS ? stats : nil
}

/// Total bytes received and sent on all non-loopback interfaces.
/// These counters are 32-bit per interface, so they wrap at 4 GB; the test ignores a wrap.
func netBytes() -> (rx: UInt64, tx: UInt64) {
    var head: UnsafeMutablePointer<ifaddrs>? = nil
    guard getifaddrs(&head) == 0, let first = head else { return (0, 0) }
    defer { freeifaddrs(head) }
    var rx: UInt64 = 0, tx: UInt64 = 0
    var cur: UnsafeMutablePointer<ifaddrs>? = first
    while let node = cur {
        let a = node.pointee
        if let addr = a.ifa_addr, Int32(addr.pointee.sa_family) == AF_LINK, let data = a.ifa_data {
            let name = String(cString: a.ifa_name)
            if !name.hasPrefix("lo") {
                let d = data.assumingMemoryBound(to: if_data.self).pointee
                rx += UInt64(d.ifi_ibytes); tx += UInt64(d.ifi_obytes)
            }
        }
        cur = a.ifa_next
    }
    return (rx, tx)
}

// ---------------------------------------------------------------- the run

var costCpu: [Double] = [], costVm: [Double] = [], costNet: [Double] = []   // microseconds per read
var changedCpu = 0, changedVm = 0, changedNet = 0
var busyPerTick: [Double] = []          // 0..1, all cores together
var faultsPerTick: [UInt64] = []        // page faults in this tick
var rxPerTick: [UInt64] = []            // bytes received in this tick

func timed<T>(_ costs: inout [Double], _ f: () -> T) -> T {
    let t0 = nowNs(); let v = f(); let t1 = nowNs()
    costs.append(Double(t1 - t0) / 1000.0)
    return v
}

guard var prevCpu = cpuTicks(), var prevVm = vmStats() else {
    print("could not read CPU or memory counters"); exit(1)
}
var prevNet = netBytes()

let ticks = max(2, Int(HZ * SECS))
let periodNs = UInt64(1e9 / HZ)
var nextNs = nowNs()
print("reading at \(HZ) Hz for \(SECS) s  (\(ticks) reads) ...  use the machine now")

for _ in 0..<ticks {
    nextNs += periodNs
    let n = nowNs()
    if nextNs > n { usleep(UInt32((nextNs - n) / 1000)) }

    guard let cpu = timed(&costCpu, { cpuTicks() }),
          let vm  = timed(&costVm,  { vmStats() }) else { continue }
    let net = timed(&costNet, { netBytes() })

    // CPU: busy = (user + system + nice) / total, summed over cores, wrap-safe
    var busy: UInt64 = 0, total: UInt64 = 0
    for c in 0..<min(cpu.count, prevCpu.count) {
        let du = UInt64(cpu[c][0] &- prevCpu[c][0]), ds = UInt64(cpu[c][1] &- prevCpu[c][1])
        let di = UInt64(cpu[c][2] &- prevCpu[c][2]), dn = UInt64(cpu[c][3] &- prevCpu[c][3])
        busy += du + ds + dn; total += du + ds + di + dn
    }
    if total > 0 { busyPerTick.append(Double(busy) / Double(total)) } else { busyPerTick.append(0) }
    if cpu != prevCpu { changedCpu += 1 }

    let df = vm.faults >= prevVm.faults ? vm.faults - prevVm.faults : 0
    faultsPerTick.append(df)
    if vm.faults != prevVm.faults || vm.pageins != prevVm.pageins { changedVm += 1 }

    let drx = net.rx >= prevNet.rx ? net.rx - prevNet.rx : 0
    rxPerTick.append(drx)
    if net.rx != prevNet.rx || net.tx != prevNet.tx { changedNet += 1 }

    prevCpu = cpu; prevVm = vm; prevNet = net
}

// ---------------------------------------------------------------- report

func mean(_ a: [Double]) -> Double { a.isEmpty ? 0 : a.reduce(0, +) / Double(a.count) }
func f(_ x: Double, _ d: Int = 1) -> String { String(format: "%.\(d)f", x) }
let nTicks = Double(busyPerTick.count)
let perSec = max(1, Int(HZ.rounded()))

// largest total over any block of one second, for comparison with a 1 Hz reader
func peakOverSecond(_ a: [Double]) -> Double {
    guard a.count >= perSec else { return a.reduce(0, +) }
    var best = 0.0
    var i = 0
    while i + perSec <= a.count { best = max(best, a[i..<(i + perSec)].reduce(0, +)); i += perSec }
    return best
}

print("")
print("source   read cost (mean / max)    changed since last read")
print("CPU      \(f(mean(costCpu))) / \(f(costCpu.max() ?? 0)) us         \(f(100 * Double(changedCpu) / max(nTicks, 1), 0)) % of reads")
print("memory   \(f(mean(costVm))) / \(f(costVm.max() ?? 0)) us         \(f(100 * Double(changedVm) / max(nTicks, 1), 0)) % of reads")
print("network  \(f(mean(costNet))) / \(f(costNet.max() ?? 0)) us         \(f(100 * Double(changedNet) / max(nTicks, 1), 0)) % of reads")
print("")
print("burst detail (this is what 1 Hz reading hides):")
let peakBusyFast = (busyPerTick.max() ?? 0) * 100
let peakBusySlow = peakOverSecond(busyPerTick) / Double(perSec) * 100
print("  CPU busy peak      \(f(peakBusyFast, 0)) % at \(f(HZ, 0)) Hz   vs   \(f(peakBusySlow, 0)) % averaged over 1 s")
let fast = Double(faultsPerTick.map { Double($0) }.max() ?? 0) * HZ
let slow = peakOverSecond(faultsPerTick.map { Double($0) })
print("  page faults peak   \(f(fast, 0)) /s at \(f(HZ, 0)) Hz   vs   \(f(slow, 0)) /s over 1 s")
let rfast = Double(rxPerTick.map { Double($0) }.max() ?? 0) * HZ
let rslow = peakOverSecond(rxPerTick.map { Double($0) })
print("  bytes in peak      \(f(rfast, 0)) B/s at \(f(HZ, 0)) Hz   vs   \(f(rslow, 0)) B/s over 1 s")
print("")
print("how to read this: if 'changed' is near 100 % the counter really updates at your read rate;")
print("if it is near 100/\(f(HZ, 0)) % it only changes once per second and faster reading buys nothing.")
