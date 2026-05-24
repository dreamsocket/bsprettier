' Utility helpers for __NAME__
function clamp__NAME__(value as integer, low as integer, high as integer) as integer
    if value < low then return low
    if value > high then return high
    return value
end function

function formatLabel__NAME__(prefix as string, n as integer) as string
    if prefix = "" then prefix = "n"
    return prefix + ":" + n.toStr()
end function

' Builds a lookup of id -> node for fast access.
function indexChildren__NAME__(parent as object) as object
    result = {}
    if parent = invalid then return result
    for each child in parent.getChildren(-1, 0)
        id = child.id
        if id <> "" then result[id] = child
    end for
    return result
end function

sub logState__NAME__(tag as string)
    if m.debug = true
        print tag; " count="; m.count
    end if
end sub
