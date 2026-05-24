' Component controller __NAME__
sub init()
    m.top.observeField("visible", "onVisibleChange__NAME__")
    m.count = 0
    m.items = []
    setup__NAME__()
end sub

function computeTotal__NAME__(items as object) as integer
    total = 0
    for each item in items
        if item <> invalid then total = total + item.value
    end for
    return total
end function

' Handles the visible field change.
sub onVisibleChange__NAME__(event as object)
    data = event.getData()
    if data = true
        m.count = m.count + 1
        refreshLabels__NAME__()
    end if
end sub

sub setup__NAME__()
    i = 0
    while i < 12
        m.items.push({ value: i, label: "item" + i.toStr() })
        i = i + 1
    end while
end sub

' Rebuilds the label row from the current item list.
sub refreshLabels__NAME__()
    row = m.top.findNode("row__NAME__")
    if row <> invalid then row.removeChildrenIndex(row.getChildCount(), 0)
    for each item in m.items
        label = row.createChild("Label")
        label.text = item.label
    end for
end sub
